import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Page, Layout, Card, FormLayout, Select, TextField, Button, Banner,
  IndexTable, Text, InlineStack, BlockStack, Box, Spinner, Badge, Link,
  Autocomplete, Icon, Popover, ActionList, Divider, Checkbox, Modal,
} from '@shopify/polaris';
import { SearchIcon, DeleteIcon, SettingsIcon, ImportIcon } from '@shopify/polaris-icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdjustment, createAdjustment, updateAdjustment,
  saveAdjustment, archiveAdjustment, deleteAdjustment,
  reverseAdjustment, getInventoryLevel,
} from '../../api/adjustments.js';
import { getLocations } from '../../api/inventory.js';
import { getProducts } from '../../api/products.js';
import { getAdjustmentReasons } from '../../api/adjustmentReasons.js';
import { parseCSV, downloadCSVFile } from '../../utils/csv.js';
import SkuMatchModal from '../../components/SkuMatchModal.jsx';
import ArchivedSkuModal from '../../components/ArchivedSkuModal.jsx';

function matchLabel(product, variant) {
  const name = product.variants.length === 1 ? product.title : `${product.title} — ${variant.title}`;
  const archivedTag = product.status === 'ARCHIVED' ? ' [Archived]' : '';
  return `${name} (SKU: ${variant.sku})${archivedTag}`;
}

function formatReason(preset) {
  return preset.code ?? '—';
}

const ADJUSTMENT_CSV_EXAMPLE = [
  ['sku', 'adjustment'],
  ['SKU-001', '5'],
  ['SKU-002', '-3'],
  ['SKU-003', '10'],
];

const ALL_COLUMNS = [
  { id: 'product', title: 'Product' },
  { id: 'variant', title: 'Variant' },
  { id: 'sku', title: 'SKU' },
  { id: 'status', title: 'Status' },
  { id: 'oldQty', title: 'Old Qty' },
  { id: 'delta', title: 'Adjustment' },
  { id: 'newQty', title: 'New Qty' },
];

function downloadCSV(adj, lineItems, locationName) {
  const headers = ['Product', 'Variant', 'SKU', 'Status', 'Old Qty', 'Adjustment', 'New Qty'];
  const rows = lineItems.map((li) => [
    li.productTitle ?? '',
    li.variantTitle ?? '',
    li.sku ?? '',
    li.productStatus ?? '',
    li.oldQty ?? '',
    li.delta,
    li.oldQty != null ? li.oldQty + li.delta : '',
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `adjustment-${adj.adjNumber}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdjustmentDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Load existing ─────────────────────────────────────────────────────────
  const { data: existing, isLoading: loadingAdj } = useQuery({
    queryKey: ['adjustment', id],
    queryFn: () => getAdjustment(id),
    enabled: !isNew,
  });

  const isArchived = existing?.status === 'archived';

  // ── Locations ─────────────────────────────────────────────────────────────
  const { data: locationsRaw } = useQuery({
    queryKey: ['locations'],
    queryFn: getLocations,
  });
  const locations = locationsRaw?.data ?? [];

  // ── Reason presets ──────────────────────────────────────────────────────��─
  const { data: reasonPresets = [] } = useQuery({
    queryKey: ['adjustment-reasons'],
    queryFn: getAdjustmentReasons,
  });
  const locationOptions = [
    { label: 'Select location…', value: '' },
    ...locations.map((l) => ({ label: l.name, value: l.id })),
  ];

  // ── Footer form state ─────────────────────────────────────────────────────
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');            // preset code, or free text if no preset matches
  const [reasonInput, setReasonInput] = useState('');   // text shown/typed in the reason field
  const [employee, setEmployee] = useState('');

  // ── Line items ────────────────────────────────────────────────────────────
  const [lineItems, setLineItems] = useState([]);
  // { shopifyVariantId, inventoryItemId, productTitle, variantTitle, sku, productStatus, oldQty, delta }

  // ── Column visibility ─────────────────────────────────────────────────────
  const [visibleCols, setVisibleCols] = useState(new Set(ALL_COLUMNS.map((c) => c.id)));
  const [colPopover, setColPopover] = useState(false);

  // ── CSV import ────────────────────────────────────────────────────────────
  const csvFileRef = useRef(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState(null); // { added, skipped, notFound }
  const [archivedModalSkus, setArchivedModalSkus] = useState([]);

  // ── Ambiguous SKU matches (duplicate SKU across active products) ───────────
  const [ambiguous, setAmbiguous] = useState([]); // [{ sku, delta, matches: [{product, variant}] }]
  const [ambiguousSelections, setAmbiguousSelections] = useState({}); // { [sku]: variantId }

  const buildItemFromMatch = useCallback((product, variant, delta) => ({
    shopifyVariantId: variant.id,
    inventoryItemId: variant.inventoryItemId ?? '',
    productTitle: product.title,
    variantTitle: product.variants.length === 1 ? '' : variant.title,
    sku: variant.sku ?? '',
    productStatus: product.status ?? '',
    storedOldQty: null,
    delta: delta ?? '0',
  }), []);

  const handleCsvFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setCsvImporting(true);
    setCsvResult(null);
    setSaveError(null);
    try {
      const rows = parseCSV(await file.text());
      if (rows.length === 0) return;
      const firstRow = rows[0];
      const deltaKey = 'adjustment' in firstRow ? 'adjustment' : 'delta' in firstRow ? 'delta' : null;
      if (!('sku' in firstRow) || !deltaKey) {
        setSaveError('CSV must have "sku" and "adjustment" (or "delta") columns.');
        return;
      }
      const lookups = await Promise.all(
        rows.map(async (row) => {
          const sku = row.sku?.trim();
          if (!sku) return null;
          const delta = row[deltaKey]?.trim();
          // Exact SKU match only — Shopify's sku: search tokenizes on hyphens, so
          // a search for "ABC123" also returns lookalikes like "ABC123-DISCON";
          // we never fall back to those, only a byte-for-byte match on the SKU.
          const data = await getProducts({ search: sku, searchBy: 'sku', first: 10 });
          const matches = [];
          for (const product of data.products) {
            for (const variant of product.variants) {
              if (variant.sku === sku) matches.push({ product, variant });
            }
          }
          if (matches.length === 0) return { sku, kind: 'not-found' };
          if (matches.length > 1) return { id: crypto.randomUUID(), sku, kind: 'ambiguous', delta, matches };
          const { product, variant } = matches[0];
          // Archived products are discontinued — importing an adjustment against
          // one is very likely a mistake (recycled/lookalike SKU), so flag it as
          // an error instead of silently applying it.
          if (product.status === 'ARCHIVED') return { sku, kind: 'archived' };
          return { sku, kind: 'resolved', item: buildItemFromMatch(product, variant, delta) };
        })
      );
      let added = 0, skipped = 0;
      const notFound = [];
      const archivedSkus = [];
      const newItems = [];
      const pendingAmbiguous = [];
      const existingSkus = new Set(lineItems.map((li) => li.sku));
      for (const r of lookups) {
        if (!r) continue;
        if (r.kind === 'not-found') { notFound.push(r.sku); continue; }
        if (r.kind === 'archived') { archivedSkus.push(r.sku); skipped++; continue; }
        if (r.kind === 'ambiguous') { pendingAmbiguous.push(r); continue; }
        if (existingSkus.has(r.item.sku)) { skipped++; continue; }
        existingSkus.add(r.item.sku);
        newItems.push(r.item);
        added++;
      }
      if (newItems.length > 0) setLineItems((prev) => [...prev, ...newItems]);
      setCsvResult({ added, skipped, notFound });
      if (archivedSkus.length > 0) setArchivedModalSkus(archivedSkus);
      if (pendingAmbiguous.length > 0) {
        setAmbiguous(pendingAmbiguous);
        setAmbiguousSelections({});
      }
    } catch (err) {
      setSaveError('CSV import failed: ' + err.message);
    } finally {
      setCsvImporting(false);
    }
  }, [lineItems, buildItemFromMatch]);

  const handleAmbiguousSelect = useCallback((id, variantId) => {
    setAmbiguousSelections((prev) => ({ ...prev, [id]: variantId }));
  }, []);

  const handleAmbiguousConfirm = useCallback(() => {
    const newItems = [];
    const existingSkus = new Set(lineItems.map((li) => li.sku));
    let added = 0, skipped = 0;
    const archivedSkus = [];
    for (const a of ambiguous) {
      const variantId = ambiguousSelections[a.id];
      const match = variantId && a.matches.find((m) => m.variant.id === variantId);
      if (!match) { skipped++; continue; }
      if (match.product.status === 'ARCHIVED') { archivedSkus.push(a.sku); skipped++; continue; }
      if (existingSkus.has(match.variant.sku ?? '')) { skipped++; continue; }
      existingSkus.add(match.variant.sku ?? '');
      newItems.push(buildItemFromMatch(match.product, match.variant, a.delta));
      added++;
    }
    if (newItems.length > 0) setLineItems((prev) => [...prev, ...newItems]);
    setCsvResult((prev) => prev
      ? { ...prev, added: prev.added + added, skipped: prev.skipped + skipped }
      : { added, skipped, notFound: [] });
    if (archivedSkus.length > 0) setArchivedModalSkus((prev) => [...prev, ...archivedSkus]);
    setAmbiguous([]);
    setAmbiguousSelections({});
  }, [ambiguous, ambiguousSelections, lineItems, buildItemFromMatch]);

  const handleAmbiguousCancel = useCallback(() => {
    setCsvResult((prev) => prev
      ? { ...prev, skipped: prev.skipped + ambiguous.length }
      : { added: 0, skipped: ambiguous.length, notFound: [] });
    setAmbiguous([]);
    setAmbiguousSelections({});
  }, [ambiguous]);

  // ── Error ─────────────────────────────────────────────────────────────────
  const [saveError, setSaveError] = useState(null);

  // ── Populate from existing ────────────────────────────────────────────────
  useEffect(() => {
    if (existing) {
      setLocationId(existing.locationId ?? '');
      setNotes(existing.notes ?? '');
      setReason(existing.reason ?? '');
      setEmployee(existing.adjustedBy ?? '');
      setLineItems(existing.lineItems.map((li) => ({
        id: li.id,
        shopifyVariantId: li.shopifyVariantId,
        inventoryItemId: li.inventoryItemId,
        productTitle: li.productTitle ?? '',
        variantTitle: li.variantTitle ?? '',
        sku: li.sku ?? '',
        productStatus: li.productStatus ?? '',
        storedOldQty: li.oldQty,  // from DB for archived adjustments
        delta: String(li.delta),
      })));
    }
  }, [existing]);

  // Once presets load, show the reason's label instead of its raw code.
  useEffect(() => {
    if (existing) {
      const code = existing.reason ?? '';
      const preset = reasonPresets.find((p) => p.code === code);
      setReasonInput(preset ? formatReason(preset) : code);
    }
  }, [existing, reasonPresets]);

  // ── Variant search ────────────────────────────────────────────────────────
  const [variantSearch, setVariantSearch] = useState('');
  const [variantOptions, setVariantOptions] = useState([]);

  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ['products-search', variantSearch],
    queryFn: () => getProducts({ search: variantSearch, searchBy: 'title', first: 10 }),
    enabled: variantSearch.length >= 2,
  });

  useEffect(() => {
    if (!searchData) return;
    const opts = [];
    for (const product of searchData.products) {
      for (const v of product.variants) {
        opts.push({
          value: v.id,
          label: product.variants.length === 1
            ? product.title
            : `${product.title} — ${v.title}`,
          meta: {
            shopifyVariantId: v.id,
            inventoryItemId: v.inventoryItemId ?? '',
            productTitle: product.title,
            variantTitle: product.variants.length === 1 ? '' : v.title,
            sku: v.sku ?? '',
            productStatus: product.status ?? '',
            storedOldQty: null,
            delta: '0',
          },
        });
      }
    }
    setVariantOptions(opts);
  }, [searchData]);

  const handleSelectVariant = useCallback((selected) => {
    const opt = variantOptions.find((o) => o.value === selected[0]);
    if (!opt || lineItems.some((li) => li.shopifyVariantId === opt.meta.shopifyVariantId)) return;
    setLineItems((prev) => [...prev, opt.meta]);
    setVariantSearch('');
    setVariantOptions([]);
  }, [variantOptions, lineItems]);

  const updateDelta = useCallback((idx, val) => {
    setLineItems((prev) => prev.map((li, i) => i === idx ? { ...li, delta: val } : li));
  }, []);

  const removeLineItem = useCallback((idx) => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const clearAllLineItems = useCallback(() => {
    setLineItems([]);
  }, []);

  // ── Reason combobox ───────────────────────────────────────────────────────
  // Selecting an option stores its `code` (value) in `reason`; "CODE - Label" is shown/typed
  // in `reasonInput`. Free-typed text that matches no preset is stored verbatim as-is.
  // reasonPresets is already sorted alphanumerically by code — filter/map below preserve that order.
  const reasonOpts = reasonPresets
    .filter((p) => !reasonInput
      || (p.code ?? '').toLowerCase().includes(reasonInput.toLowerCase())
      || (p.label ?? '').toLowerCase().includes(reasonInput.toLowerCase()))
    .map((p) => ({ value: p.code, label: formatReason(p) }));

  const handleReasonInputChange = useCallback((value) => {
    setReasonInput(value);
    setReason(value);
  }, []);

  const handleReasonSelect = useCallback((selected) => {
    const code = selected[0] ?? '';
    const preset = reasonPresets.find((p) => p.code === code);
    setReason(code);
    setReasonInput(preset ? formatReason(preset) : code);
  }, [reasonPresets]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const buildBody = () => ({
    reason,
    notes,
    adjustedBy: employee,
    locationId,
    lineItems: lineItems.map((li) => ({
      shopifyVariantId: li.shopifyVariantId,
      inventoryItemId: li.inventoryItemId,
      productTitle: li.productTitle,
      variantTitle: li.variantTitle,
      sku: li.sku,
      productStatus: li.productStatus,
      delta: Number(li.delta),
    })),
  });

  const createMutation = useMutation({
    mutationFn: createAdjustment,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      navigate(`/inventory/adjustments/${data.id}`, { replace: true });
    },
    onError: (e) => setSaveError(e.message),
  });

  const draftMutation = useMutation({
    mutationFn: (body) => isNew ? createAdjustment(body) : updateAdjustment(id, body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      if (isNew) navigate(`/inventory/adjustments/${data.id}`, { replace: true });
      else queryClient.invalidateQueries({ queryKey: ['adjustment', id] });
    },
    onError: (e) => setSaveError(e.message),
  });

  const saveMutation = useMutation({
    mutationFn: (body) => saveAdjustment(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['adjustment', id] });
    },
    onError: (e) => setSaveError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAdjustment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      navigate('/inventory/adjustments');
    },
    onError: (e) => setSaveError(e.message),
  });

  const reverseMutation = useMutation({
    mutationFn: () => reverseAdjustment(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['adjustment', id] });
      setReverseModalOpen(false);
      navigate(`/inventory/adjustments/${data.id}`);
    },
    onError: (e) => {
      setReverseModalOpen(false);
      setSaveError(e.message);
    },
  });

  const handleSaveDraft = useCallback(() => {
    setSaveError(null);
    draftMutation.mutate(buildBody());
  }, [buildBody, draftMutation]);

  const handleSave = useCallback(() => {
    setSaveError(null);
    if (isNew) {
      // Create + immediately save requires two steps; create draft first then save
      createMutation.mutate(buildBody());
    } else {
      saveMutation.mutate(buildBody());
    }
  }, [isNew, buildBody, createMutation, saveMutation]);

  // ── Reverse confirmation ─────────────────────────────────────────────────
  const [reverseModalOpen, setReverseModalOpen] = useState(false);

  // ── More actions popover ──────────────────────────────────────────────────
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActions = !isNew && !isArchived ? [
    {
      content: 'Delete',
      destructive: true,
      onAction: () => { setMoreOpen(false); deleteMutation.mutate(); },
    },
  ] : [];

  // ── Page loading ──────────────────────────────────────────────────────────
  if (!isNew && loadingAdj) {
    return (
      <Page title="Adjustment">
        <Box padding="800"><InlineStack align="center"><Spinner /></InlineStack></Box>
      </Page>
    );
  }

  const title = isNew ? 'New Adjustment' : `Adjustment #${existing?.adjNumber ?? ''}`;
  const locationName = locations.find((l) => l.id === (existing?.locationId ?? locationId))?.name;

  // ── Column toggle ─────────────────────────────────────────────────────────
  const toggleCol = (colId) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      next.has(colId) ? next.delete(colId) : next.add(colId);
      return next;
    });
  };

  const visibleHeadings = ALL_COLUMNS.filter((c) => visibleCols.has(c.id));
  if (!isArchived) visibleHeadings.push({ id: 'remove', title: '' });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Page
      title={title}
      backAction={{ content: 'Adjustments', url: '/inventory/adjustments' }}
      titleMetadata={isArchived
        ? <Badge tone="success">Applied</Badge>
        : <Badge>Open</Badge>}
      primaryAction={isArchived ? undefined : {
        content: 'Save',
        onAction: handleSave,
        loading: saveMutation.isPending || createMutation.isPending,
        disabled: lineItems.length === 0 || !locationId,
      }}
      secondaryActions={[
        ...(isArchived ? [{
          content: 'Download CSV',
          onAction: () => downloadCSV(existing, existing.lineItems, locationName),
        }, ...(!existing?.reversal ? [{
          content: 'Reverse',
          onAction: () => setReverseModalOpen(true),
        }] : [])] : [{
          content: 'Save Draft',
          onAction: handleSaveDraft,
          loading: draftMutation.isPending,
        }, {
          content: 'Download CSV',
          disabled: lineItems.length === 0,
          onAction: () => downloadCSV(
            { adjNumber: existing?.adjNumber ?? 'draft' },
            lineItems.map((li) => ({ ...li, delta: Number(li.delta) })),
            locationName,
          ),
        }]),
        ...(moreActions.length ? [{
          content: 'Delete',
          destructive: true,
          onAction: () => deleteMutation.mutate(),
          loading: deleteMutation.isPending,
        }] : []),
      ]}
    >
      <Layout>
        {saveError && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setSaveError(null)}>{saveError}</Banner>
          </Layout.Section>
        )}
        {existing?.reversalOf && (
          <Layout.Section>
            <Banner tone="info">
              This is a reversal of{' '}
              <Link onClick={() => navigate(`/inventory/adjustments/${existing.reversalOf.id}`)}>
                Adjustment #{existing.reversalOf.adjNumber}
              </Link>.
            </Banner>
          </Layout.Section>
        )}
        {existing?.reversal && (
          <Layout.Section>
            <Banner tone="warning">
              This adjustment was reversed by{' '}
              <Link onClick={() => navigate(`/inventory/adjustments/${existing.reversal.id}`)}>
                Adjustment #{existing.reversal.adjNumber}
              </Link>.
            </Banner>
          </Layout.Section>
        )}
        {csvResult && (
          <Layout.Section>
            <Banner
              tone={csvResult.notFound.length > 0 ? 'warning' : 'success'}
              onDismiss={() => setCsvResult(null)}
            >
              {csvResult.added} variant{csvResult.added !== 1 ? 's' : ''} imported
              {csvResult.skipped > 0 ? `, ${csvResult.skipped} skipped` : ''}
              {csvResult.notFound.length > 0
                ? `, ${csvResult.notFound.length} SKU${csvResult.notFound.length !== 1 ? 's' : ''} not found: ${csvResult.notFound.join(', ')}`
                : ''}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            {/* Table toolbar */}
            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
              <InlineStack align="space-between" blockAlign="center">
                {!isArchived && (
                  <>
                    <input
                      ref={csvFileRef}
                      type="file"
                      accept=".csv,text/csv"
                      style={{ display: 'none' }}
                      onChange={handleCsvFileSelect}
                    />
                    <InlineStack gap="200" blockAlign="center">
                      <Button
                        icon={ImportIcon}
                        size="slim"
                        loading={csvImporting}
                        onClick={() => csvFileRef.current?.click()}
                      >
                        Import CSV
                      </Button>
                      <Button
                        size="slim"
                        variant="plain"
                        onClick={() => downloadCSVFile('adjustment-import-example.csv', ADJUSTMENT_CSV_EXAMPLE)}
                      >
                        Download example
                      </Button>
                      <Button
                        size="slim"
                        variant="plain"
                        tone="critical"
                        disabled={lineItems.length === 0}
                        onClick={clearAllLineItems}
                      >
                        Remove all
                      </Button>
                    </InlineStack>
                  </>
                )}
                {isArchived && <span />}
                <Popover
                  active={colPopover}
                  activator={
                    <Button
                      icon={SettingsIcon}
                      size="slim"
                      onClick={() => setColPopover((v) => !v)}
                    >
                      Columns
                    </Button>
                  }
                  onClose={() => setColPopover(false)}
                >
                  <Box padding="300" minWidth="160px">
                    <BlockStack gap="200">
                      {ALL_COLUMNS.map((col) => (
                        <Checkbox
                          key={col.id}
                          label={col.title}
                          checked={visibleCols.has(col.id)}
                          onChange={() => toggleCol(col.id)}
                        />
                      ))}
                    </BlockStack>
                  </Box>
                </Popover>
              </InlineStack>
            </Box>

            {/* Line items table */}
            <IndexTable
              resourceName={{ singular: 'item', plural: 'items' }}
              itemCount={lineItems.length}
              headings={visibleHeadings.map((c) => ({ id: c.id, title: c.title }))}
              selectable={false}
              emptyState={
                <Box padding="600">
                  <Text tone="subdued" alignment="center">
                    {!locationId ? 'Select a location below, then search for variants to add.' : 'Search for variants to add.'}
                  </Text>
                </Box>
              }
            >
              {lineItems.map((li, index) => {
                const delta = Number(li.delta) || 0;
                return (
                  <IndexTable.Row id={`li-${index}`} key={`li-${index}`} position={index}>
                    {visibleCols.has('product') && (
                      <IndexTable.Cell>
                        <Text fontWeight="semibold">{li.productTitle || '—'}</Text>
                      </IndexTable.Cell>
                    )}
                    {visibleCols.has('variant') && (
                      <IndexTable.Cell>
                        <Text tone="subdued">{li.variantTitle || '—'}</Text>
                      </IndexTable.Cell>
                    )}
                    {visibleCols.has('sku') && (
                      <IndexTable.Cell>
                        <Text tone="subdued">{li.sku || '—'}</Text>
                      </IndexTable.Cell>
                    )}
                    {visibleCols.has('status') && (
                      <IndexTable.Cell>
                        {li.productStatus
                          ? <Badge tone={li.productStatus === 'ACTIVE' ? undefined : 'attention'}>
                              {li.productStatus.charAt(0) + li.productStatus.slice(1).toLowerCase()}
                            </Badge>
                          : <Text tone="subdued">—</Text>}
                      </IndexTable.Cell>
                    )}
                    {visibleCols.has('oldQty') && (
                      <IndexTable.Cell>
                        <OldQtyCell
                          inventoryItemId={li.inventoryItemId}
                          locationId={locationId}
                          storedQty={li.storedOldQty}
                          isArchived={isArchived}
                        />
                      </IndexTable.Cell>
                    )}
                    {visibleCols.has('delta') && (
                      <IndexTable.Cell>
                        {isArchived ? (
                          <Text tone={delta >= 0 ? 'success' : 'critical'}>
                            {delta >= 0 ? `+${delta}` : delta}
                          </Text>
                        ) : (
                          <div style={{ width: 90 }}>
                            <TextField
                              label="Adjustment"
                              labelHidden
                              type="number"
                              value={li.delta}
                              onChange={(v) => updateDelta(index, v)}
                              autoComplete="off"
                            />
                          </div>
                        )}
                      </IndexTable.Cell>
                    )}
                    {visibleCols.has('newQty') && (
                      <IndexTable.Cell>
                        <NewQtyCell
                          inventoryItemId={li.inventoryItemId}
                          locationId={locationId}
                          storedQty={li.storedOldQty}
                          isArchived={isArchived}
                          delta={delta}
                        />
                      </IndexTable.Cell>
                    )}
                    {!isArchived && (
                      <IndexTable.Cell>
                        <Button
                          icon={DeleteIcon}
                          size="micro"
                          tone="critical"
                          variant="plain"
                          onClick={() => removeLineItem(index)}
                        />
                      </IndexTable.Cell>
                    )}
                  </IndexTable.Row>
                );
              })}
            </IndexTable>

            {/* Variant search */}
            {!isArchived && (
              <>
                <Divider />
                <Box padding="400">
                  <Autocomplete
                    options={variantOptions}
                    selected={[]}
                    onSelect={handleSelectVariant}
                    loading={searching}
                    textField={
                      <Autocomplete.TextField
                        label="Search variants"
                        labelHidden
                        value={variantSearch}
                        onChange={setVariantSearch}
                        prefix={<Icon source={SearchIcon} />}
                        placeholder="Search by product title to add a variant…"
                        autoComplete="off"
                      />
                    }
                  />
                </Box>
              </>
            )}
          </Card>

          {/* Footer fields */}
          <Card>
            <FormLayout>
              <FormLayout.Group>
                <Select
                  label="Location"
                  options={locationOptions}
                  value={locationId}
                  onChange={setLocationId}
                  disabled={isArchived}
                  helpText={isArchived ? locationName : undefined}
                />
                <Autocomplete
                  options={reasonOpts}
                  selected={reasonOpts.some((o) => o.value === reason) ? [reason] : []}
                  onSelect={handleReasonSelect}
                  textField={
                    <Autocomplete.TextField
                      label="Reason"
                      value={reasonInput}
                      onChange={handleReasonInputChange}
                      placeholder="Select or type a reason…"
                      autoComplete="off"
                      disabled={isArchived}
                    />
                  }
                />
              </FormLayout.Group>
              <FormLayout.Group>
                <TextField
                  label="Notes"
                  value={notes}
                  onChange={setNotes}
                  autoComplete="off"
                  multiline={2}
                  disabled={isArchived}
                />
                <TextField
                  label="Employee"
                  value={employee}
                  onChange={setEmployee}
                  autoComplete="off"
                  disabled={isArchived}
                />
              </FormLayout.Group>
            </FormLayout>
          </Card>
        </Layout.Section>
      </Layout>

      {/* ── Reverse confirmation ─────────────────────────────────────────── */}
      <Modal
        open={reverseModalOpen}
        onClose={() => setReverseModalOpen(false)}
        title={`Reverse Adjustment #${existing?.adjNumber ?? ''}`}
        primaryAction={{
          content: 'Confirm reversal',
          destructive: true,
          onAction: () => reverseMutation.mutate(),
          loading: reverseMutation.isPending,
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setReverseModalOpen(false),
          disabled: reverseMutation.isPending,
        }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text>
              This creates a new adjustment at <Text as="span" fontWeight="semibold">{locationName}</Text>{' '}
              that applies the opposite of every line item below, and posts it to Shopify immediately.
            </Text>
            <BlockStack gap="300">
              {existing?.lineItems?.map((li) => (
                <InlineStack key={li.id} align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="050">
                    <Text variant="bodyMd" fontWeight="semibold">
                      {li.productTitle}{li.variantTitle ? ` — ${li.variantTitle}` : ''}
                    </Text>
                    <Text variant="bodySm" tone="subdued">{li.sku || li.shopifyVariantId}</Text>
                  </BlockStack>
                  <InlineStack gap="300" blockAlign="center">
                    <BlockStack gap="050" inlineAlign="center">
                      <Text variant="bodySm" tone="subdued" alignment="end">Current</Text>
                      <OldQtyCell
                        inventoryItemId={li.inventoryItemId}
                        locationId={existing.locationId}
                        storedQty={null}
                        isArchived={false}
                      />
                    </BlockStack>
                    <Text tone="subdued">→</Text>
                    <BlockStack gap="050" inlineAlign="center">
                      <Text variant="bodySm" tone="subdued" alignment="end">After reversal</Text>
                      <NewQtyCell
                        inventoryItemId={li.inventoryItemId}
                        locationId={existing.locationId}
                        storedQty={null}
                        isArchived={false}
                        delta={-li.delta}
                      />
                    </BlockStack>
                  </InlineStack>
                </InlineStack>
              ))}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <SkuMatchModal
        open={ambiguous.length > 0}
        items={ambiguous.map((a) => ({
          id: a.id,
          sku: a.sku,
          options: a.matches.map((m) => ({ label: matchLabel(m.product, m.variant), value: m.variant.id })),
        }))}
        selections={ambiguousSelections}
        onSelect={handleAmbiguousSelect}
        onConfirm={handleAmbiguousConfirm}
        onCancel={handleAmbiguousCancel}
      />

      <ArchivedSkuModal
        open={archivedModalSkus.length > 0}
        skus={archivedModalSkus}
        onClose={() => setArchivedModalSkus([])}
      />
    </Page>
  );
}

// ── Inventory level cells ─────────────────────────────────────────────────────
function useStoredOrLiveQty(inventoryItemId, locationId, storedQty, isArchived) {
  const { data, isLoading } = useQuery({
    queryKey: ['inv-level', inventoryItemId, locationId],
    queryFn: () => getInventoryLevel(inventoryItemId, locationId),
    enabled: storedQty == null && !isArchived && !!(inventoryItemId && locationId),
    staleTime: 60_000,
  });
  if (storedQty != null) return { qty: storedQty, isLoading: false };
  return { qty: data ?? null, isLoading };
}

function OldQtyCell({ inventoryItemId, locationId, storedQty, isArchived }) {
  const { qty, isLoading } = useStoredOrLiveQty(inventoryItemId, locationId, storedQty, isArchived);
  if (!locationId && !isArchived) return <Text tone="subdued">—</Text>;
  if (isLoading) return <Spinner size="small" />;
  return <Text>{qty ?? 0}</Text>;
}

function NewQtyCell({ inventoryItemId, locationId, storedQty, isArchived, delta }) {
  const { qty, isLoading } = useStoredOrLiveQty(inventoryItemId, locationId, storedQty, isArchived);
  if (!locationId && !isArchived) return <Text tone="subdued">—</Text>;
  if (isLoading) return <Spinner size="small" />;
  const newQty = (qty ?? 0) + delta;
  return <Text tone={newQty < 0 ? 'critical' : undefined}>{newQty}</Text>;
}
