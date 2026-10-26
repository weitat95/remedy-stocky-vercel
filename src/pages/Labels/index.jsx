import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Page, Layout, Card, IndexTable, Text, Button, Banner, Badge, BlockStack, InlineStack, Modal, Toast,
  TextField, Checkbox, Autocomplete, Icon, EmptyState, Box, List, Link,
} from '@shopify/polaris';
import { SearchIcon, DeleteIcon } from '@shopify/polaris-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProducts } from '../../api/products.js';
import {
  getLabelVariants, getLabelTemplates, createLabelTemplate, updateLabelTemplate, deleteLabelTemplate,
} from '../../api/labels.js';
import { parseCSV, downloadCSVFile } from '../../utils/csv.js';
import SkuMatchModal from '../../components/SkuMatchModal.jsx';
import TemplatePanel from './TemplatePanel.jsx';
import { configFromPreset } from '../../utils/labels/presets.js';
import { layoutLabel, maxBarcodeScale } from '../../utils/labels/layout.js';
import { checkRows, layoutDataFor, parseQty, PRICE_SOURCE_LABELS, MAX_LABELS_PER_RUN } from '../../utils/labels/rows.js';
import { formatPrice } from '../../utils/labels/text.js';
import { makeMeasure, renderLabelsPdf, renderPreview } from '../../utils/labels/render.js';

const CSV_EXAMPLE = [['sku', 'quantity'], ['SKU-001', '5'], ['SKU-002', '10']];
const SAMPLE_DATA = { title: 'Card Wallet - Black', price: 'RM99.00', sku: 'WAL-BLK', custom: null, barcode: '30000444' };
const PRICE_FIELD = { price: 'price', compareAt: 'compareAtPrice', vendorRrp: 'vendorRrp' };
const DEFAULT_PRESET = 'dymo-30252';

// Bounded concurrency, not Promise.all — see the THROTTLED note in CLAUDE.md.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const numericId = (gid) => String(gid || '').split('/').pop();
let rowSeq = 0;
const newRow = (o) => ({ id: `row-${++rowSeq}`, csvLine: null, sku: '', qty: '', variantId: null, variant: null, resolution: null, ...o });

// Exact SKU match only (Shopify's sku: search also returns lookalikes like ABC123-DISCON).
async function lookupSku(sku) {
  const d = await getProducts({ search: sku, searchBy: 'sku', first: 10 });
  const matches = [];
  for (const product of d.products) for (const variant of product.variants) if (variant.sku === sku) matches.push({ product, variant });
  return matches;
}

const matchLabel = (product, variant) =>
  `${product.variants.length === 1 ? product.title : `${product.title} — ${variant.title}`} (SKU: ${variant.sku})${product.status === 'ARCHIVED' ? ' [Archived]' : ''}`;

const sameConfig = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function Labels() {
  const queryClient = useQueryClient();
  const measure = useMemo(() => makeMeasure(), []);
  const [toast, setToast] = useState(null);

  // ── Template (draft config + which saved template it came from) ───────────
  const [cfg, setCfg] = useState(() => configFromPreset(DEFAULT_PRESET));
  const [selectedId, setSelectedId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const { data: templates = [], isSuccess: templatesLoaded } = useQuery({ queryKey: ['label-templates'], queryFn: getLabelTemplates });
  const selected = templates.find((t) => t.id === selectedId) || null;
  const dirty = selected ? !sameConfig(selected.config, cfg) : false;

  const pickTemplate = useCallback((id, list = templates) => {
    setSelectedId(id);
    const t = list.find((x) => x.id === id);
    if (t) { setCfg(t.config); setTemplateName(t.name); setMakeDefault(t.isDefault); }
    else { setTemplateName(''); setMakeDefault(false); }
  }, [templates]);

  // Open with the default template, once.
  const openedDefault = useRef(false);
  useEffect(() => {
    if (!templatesLoaded || openedDefault.current) return;
    openedDefault.current = true;
    const def = templates.find((t) => t.isDefault);
    if (def) pickTemplate(def.id);
  }, [templatesLoaded, templates, pickTemplate]);

  const saveMutation = useMutation({
    mutationFn: ({ asNew }) => {
      const payload = { name: templateName.trim(), config: cfg, isDefault: makeDefault };
      return selected && !asNew ? updateLabelTemplate(selected.id, payload) : createLabelTemplate(payload);
    },
    onSuccess: async (t) => {
      const list = await queryClient.fetchQuery({ queryKey: ['label-templates'], queryFn: getLabelTemplates, staleTime: 0 });
      pickTemplate(t.id, list);
      setToast('Template saved');
    },
    onError: (err) => setToast(err.response?.data?.error || err.message),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteLabelTemplate(selected.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['label-templates'] });
      setSelectedId(''); setTemplateName(''); setMakeDefault(false);
      setToast('Template deleted');
    },
    onError: (err) => setToast(err.response?.data?.error || err.message),
  });

  // ── Rows ──────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState([]);
  const [adminBase, setAdminBase] = useState('');
  const [allowNoPrice, setAllowNoPrice] = useState(false);
  const checks = useMemo(() => checkRows(rows, cfg, measure, { allowNoPrice }), [rows, cfg, measure, allowNoPrice]);

  // Fetch label data (barcode/price/…) for rows that have a variantId and attach it.
  const attachVariants = useCallback(async (variantIds) => {
    if (!variantIds.length) return;
    const { shopifyAdminBase, variants } = await getLabelVariants(variantIds);
    setAdminBase(shopifyAdminBase);
    const byId = new Map(variants.map((v) => [v.variantId, v]));
    setRows((prev) => prev.map((r) => {
      if (!r.variantId || !byId.has(r.variantId)) return r;
      return { ...r, variant: byId.get(r.variantId), resolution: null };
    }));
  }, []);

  // Look SKUs up; returns { resolved: [{rowId, variantId}], unresolved: [{rowId, resolution}], ambiguous: [...] }.
  const resolveSkus = useCallback(async (list) => {
    const out = await mapWithConcurrency(list, 8, async (r) => {
      const sku = (r.sku || '').trim();
      if (!sku) return { rowId: r.id, resolution: 'blank-sku' };
      const matches = await lookupSku(sku);
      if (matches.length === 0) return { rowId: r.id, resolution: 'not-found' };
      if (matches.length > 1) return { rowId: r.id, ambiguous: { id: r.id, sku, options: matches.map((m) => ({ label: matchLabel(m.product, m.variant), value: m.variant.id })) } };
      return { rowId: r.id, variantId: matches[0].variant.id };
    });
    return out;
  }, []);

  const [ambiguous, setAmbiguous] = useState([]);
  const [ambiguousSelections, setAmbiguousSelections] = useState({});

  const applyResolution = useCallback(async (out) => {
    const byRow = new Map(out.map((o) => [o.rowId, o]));
    const amb = out.filter((o) => o.ambiguous).map((o) => o.ambiguous);
    setRows((prev) => prev.map((r) => {
      const o = byRow.get(r.id);
      if (!o) return r;
      if (o.variantId) return { ...r, variantId: o.variantId, resolution: null };
      if (o.ambiguous) return { ...r, resolution: 'multiple' };
      return { ...r, resolution: o.resolution };
    }));
    await attachVariants(out.filter((o) => o.variantId).map((o) => o.variantId));
    if (amb.length) { setAmbiguous(amb); setAmbiguousSelections({}); }
  }, [attachVariants]);

  const handleAmbiguousConfirm = useCallback(async () => {
    const ids = [];
    setRows((prev) => prev.map((r) => {
      const pick = ambiguousSelections[r.id];
      if (!pick || !ambiguous.some((a) => a.id === r.id)) return r;
      ids.push(pick);
      return { ...r, variantId: pick, resolution: null };
    }));
    setAmbiguous([]); setAmbiguousSelections({});
    await attachVariants(ids);
  }, [ambiguous, ambiguousSelections, attachVariants]);

  // ── CSV import ────────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const fileInputRef = useRef(null);

  const handleCsvFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true); setImportError(null);
    try {
      const csvRows = parseCSV(await file.text());
      if (!csvRows.length) { setImportError('CSV file is empty or has no data rows.'); return; }
      const qtyKey = ['quantity', 'qty'].find((k) => k in csvRows[0]);
      if (!('sku' in csvRows[0]) || !qtyKey) { setImportError('CSV must have "sku" and "quantity" columns.'); return; }
      const added = csvRows.map((r, i) => newRow({ csvLine: i + 2, sku: (r.sku || '').trim(), qty: (r[qtyKey] ?? '').trim() }));
      setRows((prev) => [...prev, ...added]);
      setImportOpen(false);
      await applyResolution(await resolveSkus(added));
    } catch (err) {
      setImportError('CSV import failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setImporting(false);
    }
  }, [applyResolution, resolveSkus]);

  // ── Manual add (search by title) ──────────────────────────────────────────
  const [variantSearch, setVariantSearch] = useState('');
  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ['label-variant-search', variantSearch],
    queryFn: () => getProducts({ search: variantSearch, searchBy: 'title', first: 10 }),
    enabled: variantSearch.length >= 2,
  });
  const variantOptions = useMemo(() => {
    const opts = [];
    for (const product of searchData?.products || []) {
      for (const v of product.variants) {
        opts.push({ value: v.id, label: matchLabel(product, v).replace(' (SKU: null)', ''), sku: v.sku ?? '' });
      }
    }
    return opts;
  }, [searchData]);

  const handleSelectVariant = useCallback(async (picked) => {
    const opt = variantOptions.find((o) => o.value === picked[0]);
    if (!opt) return;
    const row = newRow({ sku: opt.sku, qty: '1', variantId: opt.value });
    setRows((prev) => [...prev, row]);
    setVariantSearch('');
    try { await attachVariants([opt.value]); } catch (err) { setToast(err.response?.data?.error || err.message); }
  }, [variantOptions, attachVariants]);

  // ── Re-check (after fixing things in Shopify) / edit / remove ────────────
  const [rechecking, setRechecking] = useState(false);
  const recheck = useCallback(async () => {
    setRechecking(true);
    try {
      const unresolved = rows.filter((r) => !r.variantId);
      const have = rows.filter((r) => r.variantId).map((r) => r.variantId);
      await attachVariants(have);
      if (unresolved.length) await applyResolution(await resolveSkus(unresolved));
      setToast('Re-checked against Shopify');
    } catch (err) {
      setToast(err.response?.data?.error || err.message);
    } finally {
      setRechecking(false);
    }
  }, [rows, attachVariants, applyResolution, resolveSkus]);

  const setQty = (id, qty) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, qty } : r)));
  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  // ── Preview (a real PDF of one label, so what you see is what prints) ─────
  const [guides, setGuides] = useState(true);
  const [preview, setPreview] = useState({ url: null, errors: [], source: '' });
  const previewRow = checks.printable[0]?.row || rows.find((r) => r.variant?.barcode) || null;
  useEffect(() => {
    const timer = setTimeout(() => {
      // A real row previews exactly as it will print (a missing price shows no price line, never a made-up one);
      // with no rows yet, a sample label.
      const sampleData = previewRow?.variant
        ? layoutDataFor(previewRow.variant, cfg)
        : { ...SAMPLE_DATA, price: formatPrice('99', cfg.price) };
      const res = renderPreview(cfg, sampleData, measure, { guides });
      setPreview((old) => {
        if (old.url) URL.revokeObjectURL(old.url);
        return {
          url: res.doc ? URL.createObjectURL(res.doc.output('blob')) : null,
          errors: res.errors || [],
          source: previewRow?.variant ? (previewRow.variant.sku || previewRow.variant.productTitle) : 'sample label',
        };
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [cfg, previewRow, guides, measure]);
  useEffect(() => () => { setPreview((old) => { if (old.url) URL.revokeObjectURL(old.url); return old; }); }, []);

  // ── Fit barcode ───────────────────────────────────────────────────────────
  const [fitMessage, setFitMessage] = useState('');
  const fitBarcode = () => {
    const samples = rows.filter((r) => r.variant?.barcode?.trim()).map((r) => layoutDataFor(r.variant, cfg));
    const best = maxBarcodeScale(cfg, samples.length ? samples : [{ ...SAMPLE_DATA, price: formatPrice('99', cfg.price) }], measure);
    if (best == null) { setFitMessage("Some row doesn't fit even with the smallest barcode — see the row messages or the preview."); return; }
    setCfg((c) => ({ ...c, barcode: { ...c.barcode, scale: best } }));
    setFitMessage(`Largest that fits ${samples.length ? 'every row' : 'a sample label'}: ${Math.round(best * 100)}%`);
  };
  useEffect(() => { setFitMessage(''); }, [cfg.barcode.scale]);

  // ── Output ────────────────────────────────────────────────────────────────
  const buildPdf = () => renderLabelsPdf(cfg, checks.printable.map((p) => ({ layout: p.layout, qty: p.qty })));
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
  const openToPrint = () => {
    const url = URL.createObjectURL(buildPdf().output('blob'));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const download = () => buildPdf().save(`labels-${stamp()}.pdf`);

  // ── Render ────────────────────────────────────────────────────────────────
  const blockedCount = checks.blockedRows.length;
  const printLabelCount = checks.printable.reduce((t, p) => t + p.qty, 0);
  const priceLabel = PRICE_SOURCE_LABELS[cfg.price.source];
  const variantUrl = (r) => (adminBase && r.variant ? `${adminBase}/products/${numericId(r.variant.productId)}/variants/${numericId(r.variant.variantId)}` : null);

  const fmtPrice = (v) => (v ? formatPrice(v[PRICE_FIELD[cfg.price.source]], cfg.price) : null);

  return (
    <Page
      fullWidth
      title="Labels"
      subtitle="Print barcode labels from a CSV of SKU and quantity"
      primaryAction={{ content: 'Open to print', onAction: openToPrint, disabled: !checks.ready }}
      secondaryActions={[
        { content: 'Download PDF', onAction: download, disabled: !checks.ready },
        { content: 'Import CSV', onAction: () => { setImportError(null); setImportOpen(true); } },
        { content: 'Re-check', onAction: recheck, disabled: !rows.length || rechecking, loading: rechecking },
      ]}
    >
      <Layout>
        <Layout.Section variant="oneThird">
          <TemplatePanel
            cfg={cfg} setCfg={setCfg} templates={templates} selectedId={selectedId} onSelectTemplate={(id) => pickTemplate(id)}
            templateName={templateName} setTemplateName={setTemplateName} makeDefault={makeDefault} setMakeDefault={setMakeDefault}
            dirty={dirty} saving={saveMutation.isPending || deleteMutation.isPending}
            onSave={() => saveMutation.mutate({ asNew: false })} onSaveAsNew={() => saveMutation.mutate({ asNew: true })}
            onDelete={() => deleteMutation.mutate()} onFitBarcode={fitBarcode} fitMessage={fitMessage}
          />
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">
            {checks.runErrors.length > 0 && (
              <Banner tone="critical" title="Fix these before printing">
                <List>{checks.runErrors.map((e) => <List.Item key={e}>{e}</List.Item>)}</List>
              </Banner>
            )}
            {blockedCount > 0 && (
              <Banner tone="critical" title={`${blockedCount} row${blockedCount === 1 ? '' : 's'} need fixing — nothing prints until every row is clean`}>
                <Text as="p">Fix barcodes and prices in Shopify (links in the table), then press Re-check. Wrong quantities can be edited in the table; rows you don't want can be removed.</Text>
              </Banner>
            )}
            {allowNoPrice && checks.skippedRows.length > 0 && (
              <Banner tone="warning" title={`${checks.skippedRows.length} row${checks.skippedRows.length === 1 ? '' : 's'} will be skipped — no ${priceLabel}`}>
                <Text as="p">{checks.skippedRows.map((r) => r.variant?.sku || r.sku).join(', ')}</Text>
              </Banner>
            )}
            {checks.ready && (
              <Banner tone="success">
                <Text as="p">{printLabelCount} label{printLabelCount === 1 ? '' : 's'} from {checks.printable.length} variant{checks.printable.length === 1 ? '' : 's'} ready to print.</Text>
              </Banner>
            )}

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Preview{preview.source ? ` — ${preview.source}` : ''}</Text>
                  <Checkbox label="Show label outline" checked={guides} onChange={setGuides} />
                </InlineStack>
                {preview.errors.length > 0 ? (
                  <Banner tone="critical">{preview.errors.map((e) => e.message).join(' · ')}</Banner>
                ) : preview.url ? (
                  <iframe title="Label preview" src={`${preview.url}#toolbar=0&navpanes=0&view=Fit`} style={{ width: '100%', height: 360, border: '1px solid #ddd', borderRadius: 8 }} />
                ) : null}
              </BlockStack>
            </Card>

            <Card padding="0">
              <Box padding="300">
                <Autocomplete
                  options={variantOptions}
                  selected={[]}
                  onSelect={handleSelectVariant}
                  loading={searching}
                  textField={
                    <Autocomplete.TextField
                      label="Add variant" labelHidden value={variantSearch} onChange={setVariantSearch}
                      prefix={<Icon source={SearchIcon} />} placeholder="Search by product title to add a variant…" autoComplete="off"
                    />
                  }
                />
              </Box>
              {rows.length === 0 ? (
                <EmptyState heading="No labels yet" image="" action={{ content: 'Import CSV', onAction: () => setImportOpen(true) }}>
                  <p>Import a CSV with <b>sku</b> and <b>quantity</b> columns, or search for a variant above.</p>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: 'label row', plural: 'label rows' }}
                  itemCount={rows.length}
                  selectable={false}
                  headings={[
                    { title: 'Line' }, { title: 'SKU' }, { title: 'Product' }, { title: 'Barcode' },
                    { title: priceLabel, alignment: 'end' }, { title: 'Qty' }, { title: 'Status' }, { title: '' },
                  ]}
                >
                  {rows.map((r, i) => {
                    const res = checks.results.get(r.id);
                    const blockers = res.issues.filter((x) => x.severity === 'block');
                    const skips = res.issues.filter((x) => x.severity === 'skip');
                    const link = variantUrl(r);
                    return (
                      <IndexTable.Row id={r.id} key={r.id} position={i}>
                        <IndexTable.Cell>{r.csvLine ?? '—'}</IndexTable.Cell>
                        <IndexTable.Cell>{r.variant?.sku || r.sku || '—'}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Text as="span">{r.variant ? `${r.variant.productTitle}${r.variant.variantTitle && r.variant.variantTitle !== 'Default Title' ? ` — ${r.variant.variantTitle}` : ''}` : '—'}</Text>
                            {link && <Link url={link} target="_blank" removeUnderline>Open in Shopify</Link>}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{r.variant ? (r.variant.barcode || <Text as="span" tone="critical">Missing</Text>) : '—'}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" alignment="end">{r.variant ? (cfg.price.on ? (fmtPrice(r.variant) || <Text as="span" tone={allowNoPrice ? 'caution' : 'critical'}>Missing</Text>) : '—') : '—'}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <div style={{ width: 80 }}>
                            <TextField label="Quantity" labelHidden autoComplete="off" value={String(r.qty ?? '')} error={parseQty(r.qty) == null}
                              onChange={(v) => setQty(r.id, v)} />
                          </div>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {blockers.length === 0 && skips.length === 0 ? <Badge tone="success">Ready</Badge> : (
                            <BlockStack gap="050">
                              {blockers.map((x) => <Text as="span" tone="critical" variant="bodySm" key={x.code + x.message}>{x.message}</Text>)}
                              {skips.map((x) => <Text as="span" tone="caution" variant="bodySm" key={x.code}>Will be skipped — {x.message}</Text>)}
                            </BlockStack>
                          )}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Button icon={DeleteIcon} variant="tertiary" accessibilityLabel="Remove row" onClick={() => removeRow(r.id)} />
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              )}
              {rows.length > 0 && (
                <Box padding="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="400" blockAlign="center">
                      <Text as="span" tone="subdued">{checks.totalLabels} label{checks.totalLabels === 1 ? '' : 's'} (limit {MAX_LABELS_PER_RUN})</Text>
                      {cfg.price.on && (
                        <Checkbox label="Allow rows with no price (skip them)" checked={allowNoPrice} onChange={setAllowNoPrice} />
                      )}
                    </InlineStack>
                    <Button variant="plain" tone="critical" onClick={() => setRows([])}>Clear all</Button>
                  </InlineStack>
                </Box>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import labels from CSV"
        primaryAction={{ content: 'Close', onAction: () => setImportOpen(false) }}>
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">Columns: <b>sku</b> and <b>quantity</b> (alias <code>qty</code>). SKUs must match exactly. Every quantity must be a whole number of at least 1. Rows are added to the list below and checked — you fix whatever is flagged.</Text>
            <InlineStack>
              <Button variant="plain" onClick={() => downloadCSVFile('labels-example.csv', CSV_EXAMPLE)}>Download example</Button>
            </InlineStack>
            {importError && <Banner tone="critical">{importError}</Banner>}
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleCsvFileSelect} />
            <Button onClick={() => fileInputRef.current?.click()} loading={importing} disabled={importing}>Choose CSV file</Button>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <SkuMatchModal
        open={ambiguous.length > 0}
        items={ambiguous}
        selections={ambiguousSelections}
        onSelect={(id, v) => setAmbiguousSelections((s) => ({ ...s, [id]: v }))}
        onConfirm={handleAmbiguousConfirm}
        onCancel={() => { setAmbiguous([]); setAmbiguousSelections({}); }}
      />

      {toast && <Toast content={toast} onDismiss={() => setToast(null)} />}
    </Page>
  );
}
