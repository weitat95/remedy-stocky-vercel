import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Page, Card, IndexTable, Text, Button, Banner, Spinner, Pagination, Box, Badge,
  TextField, Select, InlineStack, BlockStack, Modal, Toast, EmptyState, Checkbox,
} from '@shopify/polaris';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProducts, importVariantMeta } from '../../api/products.js';
import { getVendors, updateVendor } from '../../api/vendors.js';
import { previewRrpFill, applyRrpFill, getVendorVariants } from '../../api/consignment.js';
import { parseCSV, downloadCSVFile } from '../../utils/csv.js';
import SkuMatchModal from '../../components/SkuMatchModal.jsx';
import ArchivedSkuModal from '../../components/ArchivedSkuModal.jsx';

const RRP_HEADER_ALIASES = ['rrp', 'vendor_rrp'];
const RRP_CSV_EXAMPLE = [['sku', 'rrp'], ['SKU-001', '199'], ['SKU-002', '69.90']];

// Bounded concurrency, not Promise.all — see the THROTTLED note in CLAUDE.md.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const money = (n) => (n == null ? '—' : Number(n).toFixed(2));

export default function VendorRrp() {
  const queryClient = useQueryClient();
  const [vendorName, setVendorName] = useState('');
    const [toast, setToast] = useState(null);

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors', 'all'],
    queryFn: () => getVendors({ includeHidden: true }),
  });
  const vendor = vendors.find((v) => v.name === vendorName) || null;

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const { data: variants = [], isLoading, error } = useQuery({
    queryKey: ['vendor-variants', vendor?.id],
    queryFn: () => getVendorVariants(vendor.id),
    enabled: !!vendor,
  });
  const rows = useMemo(() => variants.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((v) => ({
    variantId: v.variantId,
    productTitle: v.productTitle,
    variantTitle: v.variantTitle,
    sku: v.sku,
    status: v.productStatus,
    price: v.price,
    cost: v.unitCost,
    rrp: v.vendorRrp,
  })), [variants, page]);

  // ── Vendor settings: cost margin + fallback ───────────────────────────────
  const [marginInput, setMarginInput] = useState(null); // null = untouched
  const [fallbackInput, setFallbackInput] = useState(null);
  const savedMarginPct = vendor?.costMargin != null ? String(+(Number(vendor.costMargin) * 100).toFixed(2)) : '';
  const marginValue = marginInput ?? savedMarginPct;
  const fallbackValue = fallbackInput ?? !!vendor?.useCostDerivedRrp;
  const settingsDirty = vendor && (marginValue !== savedMarginPct || fallbackValue !== !!vendor.useCostDerivedRrp);
  const settingsMutation = useMutation({
    mutationFn: () => updateVendor(vendor.id, {
      costMargin: marginValue === '' ? null : Number(marginValue),
      useCostDerivedRrp: fallbackValue,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      setMarginInput(null); setFallbackInput(null);
      setToast('Vendor settings saved');
    },
    onError: (err) => setToast(err.message),
  });

  const pickVendor = (name) => {
    setVendorName(name); setPage(0); setEdits({});
    setMarginInput(null); setFallbackInput(null);
  };

  // ── Inline edit ───────────────────────────────────────────────────────────
  const [edits, setEdits] = useState({}); // variantId -> typed string (only when it differs from saved)
  const handleEdit = useCallback((row, value) => {
    setEdits((prev) => {
      const next = { ...prev };
      const saved = row.rrp != null ? String(row.rrp) : '';
      if (value === saved) delete next[row.variantId]; else next[row.variantId] = value;
      return next;
    });
  }, []);
  const editCount = Object.keys(edits).length;
  const invalidEdit = Object.values(edits).some((v) => v !== '' && !(Number(v) >= 0));
  const saveMutation = useMutation({
    mutationFn: () => importVariantMeta(Object.entries(edits).map(([shopifyVariantId, v]) => ({ shopifyVariantId, vendorRrp: v }))),
    onSuccess: ({ imported }) => {
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ['vendor-variants'] });
      setToast(`Saved ${imported} RRP${imported === 1 ? '' : 's'}`);
    },
    onError: (err) => setToast(err.message),
  });

  // ── CSV import (SKU-keyed, exact match) ───────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [ambiguous, setAmbiguous] = useState([]);
  const [ambiguousSelections, setAmbiguousSelections] = useState({});
  const [archivedModalSkus, setArchivedModalSkus] = useState([]);
  const fileInputRef = useRef(null);

  const applyResolved = useCallback(async (records) => {
    if (!records.length) return 0;
    const { imported } = await importVariantMeta(records);
    queryClient.invalidateQueries({ queryKey: ['vendor-variants'] });
    return imported;
  }, [queryClient]);

  const handleCsvFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true); setImportError(null); setImportResult(null);
    try {
      const csvRows = parseCSV(await file.text());
      if (!csvRows.length) { setImportError('CSV file is empty or has no data rows.'); return; }
      const rrpKey = RRP_HEADER_ALIASES.find((k) => k in csvRows[0]);
      if (!('sku' in csvRows[0]) || !rrpKey) { setImportError('CSV must have "sku" and "rrp" columns.'); return; }

      const lookups = await mapWithConcurrency(csvRows, 8, async (row) => {
        const sku = row.sku?.trim();
        if (!sku) return null;
        const value = row[rrpKey]?.trim() ?? '';
        if (value !== '' && !(Number(value) >= 0)) return { sku, kind: 'bad-value', value };
        // Exact SKU match only (Shopify's sku: search returns lookalikes).
        const d = await getProducts({ search: sku, searchBy: 'sku', first: 10 });
        const matches = [];
        for (const product of d.products) for (const variant of product.variants) if (variant.sku === sku) matches.push({ product, variant });
        if (matches.length === 0) return { sku, kind: 'not-found' };
        if (matches.length > 1) return { id: crypto.randomUUID(), sku, kind: 'ambiguous', value, matches };
        if (matches[0].product.status === 'ARCHIVED') return { sku, kind: 'archived' };
        return { sku, kind: 'resolved', record: { shopifyVariantId: matches[0].variant.id, vendorRrp: value } };
      });

      const notFound = []; const badValue = []; const archived = []; const pending = []; const toApply = [];
      let skipped = 0;
      for (const r of lookups) {
        if (!r) continue;
        if (r.kind === 'not-found') notFound.push(r.sku);
        else if (r.kind === 'bad-value') { badValue.push(`${r.sku} (${r.value})`); skipped++; }
        else if (r.kind === 'archived') { archived.push(r.sku); skipped++; }
        else if (r.kind === 'ambiguous') pending.push(r);
        else toApply.push(r.record);
      }
      const imported = await applyResolved(toApply);
      setImportResult({ imported, skipped, notFound, badValue });
      if (archived.length) setArchivedModalSkus(archived);
      if (pending.length) { setAmbiguous(pending); setAmbiguousSelections({}); }
    } catch (err) {
      setImportError('CSV import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  }, [applyResolved]);

  const handleAmbiguousConfirm = useCallback(async () => {
    const archived = []; const toApply = []; let skipped = 0;
    for (const a of ambiguous) {
      const id = ambiguousSelections[a.id];
      const match = id && a.matches.find((m) => m.variant.id === id);
      if (!match) { skipped++; continue; }
      if (match.product.status === 'ARCHIVED') { archived.push(a.sku); skipped++; continue; }
      toApply.push({ shopifyVariantId: match.variant.id, vendorRrp: a.value });
    }
    const imported = await applyResolved(toApply);
    setImportResult((prev) => prev
      ? { ...prev, imported: prev.imported + imported, skipped: prev.skipped + skipped }
      : { imported, skipped, notFound: [], badValue: [] });
    if (archived.length) setArchivedModalSkus((prev) => [...prev, ...archived]);
    setAmbiguous([]); setAmbiguousSelections({});
  }, [ambiguous, ambiguousSelections, applyResolved]);

  const handleAmbiguousCancel = useCallback(() => {
    setImportResult((prev) => prev
      ? { ...prev, skipped: prev.skipped + ambiguous.length }
      : { imported: 0, skipped: ambiguous.length, notFound: [], badValue: [] });
    setAmbiguous([]); setAmbiguousSelections({});
  }, [ambiguous]);

  // ── Fill RRP from cost ────────────────────────────────────────────────────
  const [fillOpen, setFillOpen] = useState(false);
  const [fillMargin, setFillMargin] = useState('');
  const [fillOverwrite, setFillOverwrite] = useState(false);
  const [fillPreview, setFillPreview] = useState(null);
  const previewMutation = useMutation({
    mutationFn: () => previewRrpFill({ vendorId: vendor.id, margin: fillMargin, overwrite: fillOverwrite }),
    onSuccess: setFillPreview,
    onError: (err) => setToast(err.message),
  });
  const applyMutation = useMutation({
    mutationFn: () => applyRrpFill({ vendorId: vendor.id, margin: Number(fillMargin), overwrite: fillOverwrite }),
    onSuccess: ({ filled }) => {
      setFillOpen(false); setFillPreview(null);
      queryClient.invalidateQueries({ queryKey: ['vendor-variants'] });
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      setToast(`Filled ${filled} RRP${filled === 1 ? '' : 's'}`);
    },
    onError: (err) => setToast(err.message),
  });
  const openFill = () => {
    setFillMargin(savedMarginPct); setFillOverwrite(false); setFillPreview(null); setFillOpen(true);
  };
  const fillCount = fillPreview ? fillPreview.rows.filter((r) => r.willFill).length : 0;

  const vendorOptions = [{ label: 'Select a vendor…', value: '' }, ...vendors.map((v) => ({ label: v.name, value: v.name }))];

  return (
    <Page
      fullWidth
      title="Vendor RRP"
      subtitle="Consignment RRP per variant — used by vendor-facing reports instead of the Shopify price"
      secondaryActions={[
        { content: 'Import CSV', onAction: () => { setImportError(null); setImportResult(null); setImportOpen(true); } },
        { content: 'Fill RRP from cost', onAction: openFill, disabled: !vendor },
      ]}
    >
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Select label="Vendor" options={vendorOptions} value={vendorName} onChange={pickVendor} />
            {vendor && (
              <InlineStack gap="400" blockAlign="end" wrap>
                <div style={{ width: 220 }}>
                  <TextField
                    label="Margin used for costs (%)"
                    type="number"
                    value={marginValue}
                    onChange={setMarginInput}
                    autoComplete="off"
                    helpText="The margin this vendor's Shopify unit costs were set with."
                  />
                </div>
                <Checkbox
                  label="Use cost-derived RRP when no RRP is stored"
                  helpText="RRP = unit cost / (1 − margin). Never falls back to the Shopify price."
                  checked={fallbackValue}
                  onChange={setFallbackInput}
                />
                <Button onClick={() => settingsMutation.mutate()} disabled={!settingsDirty} loading={settingsMutation.isPending}>
                  Save settings
                </Button>
              </InlineStack>
            )}
          </BlockStack>
        </Card>

        {editCount > 0 && (
          <Banner tone="warning" title={`${editCount} unsaved change${editCount === 1 ? '' : 's'}`}>
            <InlineStack gap="200">
              <Button variant="primary" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={invalidEdit}>
                Save changes
              </Button>
              <Button onClick={() => setEdits({})}>Discard</Button>
            </InlineStack>
          </Banner>
        )}

        {error && <Banner tone="critical">{error.message}</Banner>}

        <Card padding="0">
          {!vendorName ? (
            <EmptyState heading="Pick a vendor" image=""><p>Choose a vendor to view and edit its variants' RRP.</p></EmptyState>
          ) : isLoading ? (
            <Box padding="800"><InlineStack align="center"><Spinner /></InlineStack></Box>
          ) : (
            <>
              <IndexTable
                resourceName={{ singular: 'variant', plural: 'variants' }}
                itemCount={rows.length}
                selectable={false}
                headings={[
                  { title: 'Product' }, { title: 'Variant' }, { title: 'SKU' },
                  { title: 'Shopify price', alignment: 'end' }, { title: 'COG (unit cost)', alignment: 'end' },
                  { title: 'Vendor RRP', alignment: 'end' },
                ]}
              >
                {rows.map((row, i) => (
                  <IndexTable.Row id={row.variantId} key={row.variantId} position={i}>
                    <IndexTable.Cell>
                      <InlineStack gap="200">
                        <Text as="span">{row.productTitle}</Text>
                        {row.status === 'ARCHIVED' && <Badge>Archived</Badge>}
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{row.variantTitle || '—'}</IndexTable.Cell>
                    <IndexTable.Cell>{row.sku || '—'}</IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" alignment="end">{money(row.price)}</Text></IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" alignment="end">{money(row.cost)}</Text></IndexTable.Cell>
                    <IndexTable.Cell>
                      <div style={{ width: 120, marginLeft: 'auto' }}>
                        <TextField
                          label="Vendor RRP" labelHidden type="number" min={0} step={0.01} autoComplete="off" align="right"
                          value={edits[row.variantId] ?? (row.rrp != null ? String(row.rrp) : '')}
                          onChange={(v) => handleEdit(row, v)}
                        />
                      </div>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
              <Box padding="300">
                <InlineStack align="center">
                  <Pagination
                    hasPrevious={page > 0}
                    onPrevious={() => setPage((p) => p - 1)}
                    hasNext={(page + 1) * PAGE_SIZE < variants.length}
                    onNext={() => setPage((p) => p + 1)}
                  />
                </InlineStack>
              </Box>
            </>
          )}
        </Card>
      </BlockStack>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import vendor RRP from CSV"
        primaryAction={{ content: 'Close', onAction: () => setImportOpen(false) }}>
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">Columns: <Text as="span" fontWeight="semibold">sku</Text>, <Text as="span" fontWeight="semibold">rrp</Text> (alias <code>vendor_rrp</code>). A blank rrp clears the stored RRP. SKUs must match exactly.</Text>
            <InlineStack>
              <Button variant="plain" onClick={() => downloadCSVFile('vendor-rrp-example.csv', RRP_CSV_EXAMPLE)}>Download example</Button>
            </InlineStack>
            {importError && <Banner tone="critical">{importError}</Banner>}
            {importResult && (
              <Banner tone={importResult.imported ? 'success' : 'warning'}>
                <BlockStack gap="100">
                  <Text as="span">Imported {importResult.imported}, skipped {importResult.skipped}.</Text>
                  {importResult.notFound.length > 0 && <Text as="span" tone="subdued">Not found: {importResult.notFound.join(', ')}</Text>}
                  {importResult.badValue.length > 0 && <Text as="span" tone="subdued">Invalid RRP: {importResult.badValue.join(', ')}</Text>}
                </BlockStack>
              </Banner>
            )}
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleCsvFileSelect} />
            <Button onClick={() => fileInputRef.current?.click()} loading={importing} disabled={importing}>Choose CSV file</Button>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal open={fillOpen} onClose={() => setFillOpen(false)} title={`Fill RRP from cost — ${vendorName}`} size="large"
        primaryAction={{
          content: `Fill ${fillCount} RRP${fillCount === 1 ? '' : 's'}`,
          onAction: () => applyMutation.mutate(),
          disabled: !fillPreview || fillCount === 0,
          loading: applyMutation.isPending,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setFillOpen(false) }]}>
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" tone="subdued">RRP = unit cost ÷ (1 − margin), rounded to 2 decimals. Enter the margin this vendor's current costs were set with. Applying also saves it as the vendor's cost margin.</Text>
            <InlineStack gap="300" blockAlign="end">
              <div style={{ width: 180 }}>
                <TextField label="Margin used for costs (%)" type="number" value={fillMargin}
                  onChange={(v) => { setFillMargin(v); setFillPreview(null); }} autoComplete="off" />
              </div>
              <Checkbox label="Overwrite existing RRPs" checked={fillOverwrite}
                onChange={(v) => { setFillOverwrite(v); setFillPreview(null); }} />
              <Button onClick={() => previewMutation.mutate()} loading={previewMutation.isPending}
                disabled={!(Number(fillMargin) >= 0 && Number(fillMargin) < 100) || fillMargin === ''}>
                Preview
              </Button>
            </InlineStack>
            {fillPreview && (
              <>
                {fillPreview.skippedNoCost.length > 0 && (
                  <Banner tone="warning" title={`${fillPreview.skippedNoCost.length} variant(s) skipped — no unit cost`}>
                    <Text as="p">{fillPreview.skippedNoCost.join(', ')}</Text>
                  </Banner>
                )}
                <IndexTable
                  resourceName={{ singular: 'variant', plural: 'variants' }}
                  itemCount={fillPreview.rows.length}
                  selectable={false}
                  headings={[
                    { title: 'SKU' }, { title: 'Unit cost', alignment: 'end' }, { title: 'New RRP', alignment: 'end' },
                    { title: 'Current RRP', alignment: 'end' }, { title: 'Shopify price', alignment: 'end' }, { title: 'Note' },
                  ]}
                >
                  {fillPreview.rows.map((r, i) => (
                    <IndexTable.Row id={r.variantId} key={r.variantId} position={i}>
                      <IndexTable.Cell>{r.sku || '—'}</IndexTable.Cell>
                      <IndexTable.Cell><Text as="span" alignment="end">{money(r.unitCost)}</Text></IndexTable.Cell>
                      <IndexTable.Cell><Text as="span" alignment="end" fontWeight="semibold">{money(r.rrp)}</Text></IndexTable.Cell>
                      <IndexTable.Cell><Text as="span" alignment="end">{money(r.currentRrp)}</Text></IndexTable.Cell>
                      <IndexTable.Cell><Text as="span" alignment="end">{money(r.price)}</Text></IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack gap="100">
                          {!r.willFill && <Badge>Kept (has RRP)</Badge>}
                          {r.flags.map((f) => <Badge key={f} tone="attention">{f}</Badge>)}
                        </InlineStack>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              </>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <SkuMatchModal
        open={ambiguous.length > 0}
        items={ambiguous.map((a) => ({
          id: a.id, sku: a.sku,
          options: a.matches.map((m) => ({
            label: `${m.product.title}${m.product.variants.length > 1 ? ` — ${m.variant.title}` : ''}${m.product.status === 'ARCHIVED' ? ' [Archived]' : ''}`,
            value: m.variant.id,
          })),
        }))}
        selections={ambiguousSelections}
        onSelect={(id, v) => setAmbiguousSelections((p) => ({ ...p, [id]: v }))}
        onConfirm={handleAmbiguousConfirm}
        onCancel={handleAmbiguousCancel}
      />
      <ArchivedSkuModal open={archivedModalSkus.length > 0} skus={archivedModalSkus} onClose={() => setArchivedModalSkus([])} />
      {toast && <Toast content={toast} onDismiss={() => setToast(null)} duration={2500} />}
    </Page>
  );
}
