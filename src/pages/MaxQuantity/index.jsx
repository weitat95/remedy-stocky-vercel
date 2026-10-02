import React, { useCallback, useRef, useState } from 'react';
import {
  Page, Card, IndexTable, Text, Button, Banner, Spinner, Pagination, Box,
  TextField, Select, InlineStack, BlockStack, Modal, Toast, EmptyState, Checkbox,
} from '@shopify/polaris';
import { SearchIcon } from '@shopify/polaris-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProducts, importVariantLocationMaxStock } from '../../api/products.js';
import { getLocations } from '../../api/inventory.js';
import { parseCSV, downloadCSVFile } from '../../utils/csv.js';
import SkuMatchModal from '../../components/SkuMatchModal.jsx';
import ArchivedSkuModal from '../../components/ArchivedSkuModal.jsx';

const SEARCH_BY_OPTIONS = [
  { label: 'Title', value: 'title' },
  { label: 'SKU', value: 'sku' },
  { label: 'Vendor', value: 'vendor' },
];

const MAX_QTY_CSV_EXAMPLE = [
  ['sku', 'max_qty'],
  ['SKU-001', '20'],
  ['SKU-002', '10'],
];

// An optional `location` column lets one CSV cover several locations at once —
// each row is matched to a location by name instead of every row applying to
// whatever's picked in the modal.
const MAX_QTY_CSV_MULTI_LOCATION_EXAMPLE = [
  ['sku', 'location', 'max_qty'],
  ['SKU-001', 'Main Store', '20'],
  ['SKU-001', 'Warehouse', '100'],
  ['SKU-002', 'Main Store', '10'],
];

// Alias order matches the app's other CSV imports (first match wins).
const MAX_QTY_HEADER_ALIASES = ['max_qty', 'maxqty', 'max_stock', 'maxstock'];

// Composite key for the edits map — Max Qty is per (variant, location), not
// global, so a variant can have a different pending edit at each location.
const HIDDEN_LOCATIONS_STORAGE_KEY = 'maxQtyHiddenLocationIds';

const editKey = (variantId, locationId) => `${variantId}::${locationId}`;

// Runs `fn` over `items` with at most `limit` in flight at once. A plain
// Promise.all over a few hundred SKUs (the client's real master Max Qty list is
// ~990 rows) fires that many individual GraphQL queries at once and reliably
// trips Shopify's THROTTLED error — see the "Query cost" gotcha in CLAUDE.md.
// This isn't real backoff, just enough throttling to keep a big CSV import from
// blowing through the rate limit the way an unbounded Promise.all would.
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

// One row per variant (Max Qty is per-variant per-location), flattened out of
// the nested product/variant shape GET /products returns.
function flattenRows(products) {
  const rows = [];
  for (const p of products) {
    for (const v of p.variants) {
      rows.push({
        shopifyVariantId: v.id,
        productTitle: p.title,
        variantTitle: p.variants.length === 1 ? '' : v.title,
        vendor: p.vendor || '—',
        sku: v.sku || '—',
        // locationId → maxStock; a location with no key means no ceiling set there.
        maxStockByLocation: v.maxStockByLocation || {},
      });
    }
  }
  return rows;
}

export default function MaxQuantity() {
  const queryClient = useQueryClient();

  const { data: locationsData } = useQuery({ queryKey: ['locations'], queryFn: getLocations });
  const locations = locationsData?.data || [];

  // Hidden (not visible) IDs are stored, so a newly added location shows by default.
  const [hiddenLocationIds, setHiddenLocationIds] = useState(() => {
    try {
      const stored = localStorage.getItem(HIDDEN_LOCATIONS_STORAGE_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const filteredLocations = locations.filter((l) => !hiddenLocationIds.has(l.id));
  // Never end up with zero columns (e.g. stale saved IDs) — fall back to all.
  const visibleLocations = filteredLocations.length ? filteredLocations : locations;
  const [columnsModalOpen, setColumnsModalOpen] = useState(false);

  const saveHiddenLocationIds = useCallback((next) => {
    try { localStorage.setItem(HIDDEN_LOCATIONS_STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
    setHiddenLocationIds(next);
  }, []);
  const toggleLocationVisible = (locationId, checked) => {
    const next = new Set(hiddenLocationIds);
    if (checked) next.delete(locationId); else next.add(locationId);
    saveHiddenLocationIds(next);
  };
  const keepFirstVisibleOnly = () => saveHiddenLocationIds(new Set(locations.slice(1).map((l) => l.id)));

  // ── Search ────────────────────────────────────────────────────────────────
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [searchBy, setSearchBy] = useState('title');

  // ── Pagination (same cursor-stack pattern as Products.jsx) ──────────────────
  const [cursorStack, setCursorStack] = useState([]);
  const [cursor, setCursor] = useState(null);
  const pageNum = cursorStack.length + 1;

  const resetPaging = () => { setCursorStack([]); setCursor(null); };

  const handleSearch = useCallback(() => {
    resetPaging();
    setSearch(searchDraft.trim());
  }, [searchDraft]);

  const handleSearchClear = useCallback(() => {
    setSearchDraft('');
    setSearch('');
    resetPaging();
  }, []);

  const handleNext = useCallback((endCursor) => {
    setCursorStack((prev) => [...prev, cursor]);
    setCursor(endCursor);
  }, [cursor]);

  const handlePrev = useCallback(() => {
    setCursorStack((prev) => {
      const next = [...prev];
      setCursor(next.pop() ?? null);
      return next;
    });
  }, []);

  // Shares the 'products' query key prefix with Products.jsx so a save/import
  // here (or there) invalidates both pages' cached data.
  const { data, isLoading, error } = useQuery({
    queryKey: ['products', 'max-quantity', search, searchBy, cursor],
    queryFn: () => getProducts({
      first: 50,
      after: cursor || undefined,
      search: search || undefined,
      searchBy: search ? searchBy : undefined,
    }),
  });

  const rows = flattenRows(data?.products ?? []);
  const pageInfo = data?.pageInfo ?? {};

  // ── Inline edit ──────────────────────────────────────────────────────────
  // Keyed by `${variantId}::${locationId}`; only ever holds a cell once its typed
  // value actually differs from what loaded, so "N changes" is just the key count.
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const handleEditCell = useCallback((row, locationId, value) => {
    const key = editKey(row.shopifyVariantId, locationId);
    setEdits((prev) => {
      const original = row.maxStockByLocation[locationId];
      const originalStr = original == null ? '' : String(original);
      const next = { ...prev };
      if (value === originalStr) delete next[key];
      else next[key] = { shopifyVariantId: row.shopifyVariantId, locationId, value, sku: row.sku };
      return next;
    });
  }, []);

  const dirtyCount = Object.keys(edits).length;
  const visibleIdSet = new Set(visibleLocations.map((l) => l.id));
  const hiddenDirtyCount = Object.keys(edits).filter((k) => !visibleIdSet.has(k.split('::')[1])).length;

  const handleSaveChanges = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const records = Object.values(edits).map(({ shopifyVariantId, locationId, value }) => ({ shopifyVariantId, locationId, maxStock: value }));
      await importVariantLocationMaxStock(records);
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setToast({ message: `Saved Max Qty for ${records.length} cell${records.length === 1 ? '' : 's'}` });
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }, [edits, queryClient]);

  const handleDiscardChanges = useCallback(() => setEdits({}), []);

  // ── CSV import (SKU-keyed, one location per import — resolves sku ->
  // shopifyVariantId, then reuses the same bulk-upsert endpoint the inline-edit
  // Save button calls) ────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importLocationId, setImportLocationId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importResult, setImportResult] = useState(null); // { imported, skipped, notFound }
  const [ambiguous, setAmbiguous] = useState([]); // [{ id, sku, value, matches }]
  const [ambiguousSelections, setAmbiguousSelections] = useState({});
  const [archivedModalSkus, setArchivedModalSkus] = useState([]);
  const fileInputRef = useRef(null);

  const applyResolved = useCallback(async (records) => {
    if (!records.length) return 0;
    const { imported } = await importVariantLocationMaxStock(records);
    queryClient.invalidateQueries({ queryKey: ['products'] });
    return imported;
  }, [queryClient]);

  const handleCsvFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const rows = parseCSV(await file.text());
      if (!rows.length) {
        setImportError('CSV file is empty or has no data rows.');
        return;
      }
      const firstRow = rows[0];
      const maxKey = MAX_QTY_HEADER_ALIASES.find((k) => k in firstRow);
      if (!('sku' in firstRow) || !maxKey) {
        setImportError('CSV must have "sku" and "max_qty" columns.');
        return;
      }
      // Optional per-row location column — lets one CSV cover several locations
      // at once instead of every row applying to whatever's picked below. A row
      // with no location column (or a blank cell) falls back to that picker.
      const hasLocationColumn = 'location' in firstRow;
      if (!hasLocationColumn && !importLocationId) {
        setImportError('Pick a location, or add a "location" column to the CSV.');
        return;
      }
      const locationsByName = new Map(locations.map((l) => [l.name.trim().toLowerCase(), l.id]));

      const lookups = await mapWithConcurrency(rows, 8, async (row) => {
        const sku = row.sku?.trim();
        if (!sku) return null;
        const value = row[maxKey]?.trim() ?? '';

        let locationId = importLocationId || null;
        if (hasLocationColumn && row.location?.trim()) {
          const found = locationsByName.get(row.location.trim().toLowerCase());
          if (!found) return { sku, kind: 'location-not-found', locationName: row.location.trim() };
          locationId = found;
        }
        if (!locationId) return { sku, kind: 'location-not-found', locationName: '(blank)' };

        // Exact SKU match only — same rule as every other CSV import in this app
        // (Shopify's sku: search tokenizes on hyphens and returns lookalikes).
        const data = await getProducts({ search: sku, searchBy: 'sku', first: 10 });
        const matches = [];
        for (const product of data.products) {
          for (const variant of product.variants) {
            if (variant.sku === sku) matches.push({ product, variant });
          }
        }
        if (matches.length === 0) return { sku, kind: 'not-found' };
        if (matches.length > 1) return { id: crypto.randomUUID(), sku, kind: 'ambiguous', value, locationId, matches };
        const { product, variant } = matches[0];
        if (product.status === 'ARCHIVED') return { sku, kind: 'archived' };
        return { sku, kind: 'resolved', record: { shopifyVariantId: variant.id, locationId, maxStock: value } };
      });

      const notFound = [];
      const locationNotFound = [];
      const archivedSkus = [];
      const pendingAmbiguous = [];
      const toApply = [];
      let skipped = 0;
      for (const r of lookups) {
        if (!r) continue;
        if (r.kind === 'not-found') { notFound.push(r.sku); continue; }
        if (r.kind === 'location-not-found') { locationNotFound.push(`${r.sku} (${r.locationName})`); skipped++; continue; }
        if (r.kind === 'archived') { archivedSkus.push(r.sku); skipped++; continue; }
        if (r.kind === 'ambiguous') { pendingAmbiguous.push(r); continue; }
        toApply.push(r.record);
      }

      const imported = await applyResolved(toApply);
      setImportResult({ imported, skipped, notFound, locationNotFound });
      if (archivedSkus.length) setArchivedModalSkus(archivedSkus);
      if (pendingAmbiguous.length) { setAmbiguous(pendingAmbiguous); setAmbiguousSelections({}); }
    } catch (err) {
      setImportError('CSV import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  }, [applyResolved, importLocationId, locations]);

  const handleAmbiguousSelect = useCallback((id, variantId) => {
    setAmbiguousSelections((prev) => ({ ...prev, [id]: variantId }));
  }, []);

  const handleAmbiguousConfirm = useCallback(async () => {
    const archivedSkus = [];
    const toApply = [];
    let skipped = 0;
    for (const a of ambiguous) {
      const variantId = ambiguousSelections[a.id];
      const match = variantId && a.matches.find((m) => m.variant.id === variantId);
      if (!match) { skipped++; continue; }
      if (match.product.status === 'ARCHIVED') { archivedSkus.push(a.sku); skipped++; continue; }
      // Each ambiguous item carries the location resolved for its own row (from
      // the CSV's location column, or the modal picker) — not a single shared one.
      toApply.push({ shopifyVariantId: match.variant.id, locationId: a.locationId, maxStock: a.value });
    }
    const imported = await applyResolved(toApply);
    setImportResult((prev) => prev
      ? { imported: prev.imported + imported, skipped: prev.skipped + skipped, notFound: prev.notFound, locationNotFound: prev.locationNotFound }
      : { imported, skipped, notFound: [], locationNotFound: [] });
    if (archivedSkus.length) setArchivedModalSkus((prev) => [...prev, ...archivedSkus]);
    setAmbiguous([]);
    setAmbiguousSelections({});
  }, [ambiguous, ambiguousSelections, applyResolved]);

  const handleAmbiguousCancel = useCallback(() => {
    setImportResult((prev) => prev
      ? { ...prev, skipped: prev.skipped + ambiguous.length }
      : { imported: 0, skipped: ambiguous.length, notFound: [], locationNotFound: [] });
    setAmbiguous([]);
    setAmbiguousSelections({});
  }, [ambiguous]);

  const locationOptions = locations.map((l) => ({ label: l.name, value: l.id }));

  const rowMarkup = rows.map((row, index) => (
    <IndexTable.Row id={row.shopifyVariantId} key={row.shopifyVariantId} position={index}>
      <IndexTable.Cell>
        <Text as="span">{row.productTitle}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{row.variantTitle || '—'}</IndexTable.Cell>
      <IndexTable.Cell>{row.sku}</IndexTable.Cell>
      <IndexTable.Cell>{row.vendor}</IndexTable.Cell>
      {visibleLocations.map((loc) => {
        const key = editKey(row.shopifyVariantId, loc.id);
        const edit = edits[key];
        const original = row.maxStockByLocation[loc.id];
        const value = edit ? edit.value : (original == null ? '' : String(original));
        return (
          <IndexTable.Cell key={loc.id}>
            <div style={{ maxWidth: 100 }} onClick={(e) => e.stopPropagation()}>
              <TextField
                labelHidden
                label={`Max Qty for ${row.sku} at ${loc.name}`}
                type="number"
                min={0}
                value={value}
                onChange={(v) => handleEditCell(row, loc.id, v)}
                autoComplete="off"
              />
            </div>
          </IndexTable.Cell>
        );
      })}
    </IndexTable.Row>
  ));

  return (
    <Page
      fullWidth
      title="Max Quantity"
      subtitle="Per-location shelf ceiling used by the Replenishment report"
      primaryAction={{ content: 'Import CSV', onAction: () => { setImportError(null); setImportResult(null); setImportOpen(true); } }}
      secondaryActions={[{ content: 'Columns', onAction: () => setColumnsModalOpen(true), disabled: !locations.length }]}
    >
      <Card>
        <BlockStack gap="400">
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <div style={{ flexGrow: 1 }}>
              <TextField
                labelHidden
                label="Search"
                placeholder="Search products…"
                value={searchDraft}
                onChange={setSearchDraft}
                onBlur={handleSearch}
                clearButton
                onClearButtonClick={handleSearchClear}
                connectedRight={<Button icon={SearchIcon} onClick={handleSearch}>Search</Button>}
                autoComplete="off"
              />
            </div>
            <Select label="Search by" labelInline options={SEARCH_BY_OPTIONS} value={searchBy} onChange={setSearchBy} />
          </InlineStack>

          {error && <Banner tone="critical">{error.message}</Banner>}
          {saveError && <Banner tone="critical" onDismiss={() => setSaveError(null)}>{saveError}</Banner>}

          {dirtyCount > 0 && (
            <Banner tone="warning">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span">{dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}{hiddenDirtyCount > 0 ? ` (${hiddenDirtyCount} in hidden columns)` : ''}</Text>
                <InlineStack gap="200">
                  <Button onClick={handleDiscardChanges} disabled={saving}>Discard</Button>
                  <Button variant="primary" onClick={handleSaveChanges} loading={saving}>Save changes</Button>
                </InlineStack>
              </InlineStack>
            </Banner>
          )}

          {isLoading ? (
            <Box padding="800"><InlineStack align="center"><Spinner /></InlineStack></Box>
          ) : locations.length === 0 ? (
            <EmptyState heading="No Shopify locations found" image="" />
          ) : rows.length === 0 ? (
            <EmptyState heading="No products found" image="" />
          ) : (
            <BlockStack gap="200">
              <IndexTable
                resourceName={{ singular: 'variant', plural: 'variants' }}
                itemCount={rows.length}
                headings={[
                  { title: 'Product' }, { title: 'Variant' }, { title: 'SKU' }, { title: 'Vendor' },
                  ...visibleLocations.map((l) => ({ title: l.name })),
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
              <Box paddingBlockStart="200">
                <InlineStack align="center">
                  <Pagination
                    hasPrevious={cursorStack.length > 0}
                    onPrevious={handlePrev}
                    hasNext={!!pageInfo.hasNextPage}
                    onNext={() => handleNext(pageInfo.endCursor)}
                    label={`Page ${pageNum}`}
                  />
                </InlineStack>
              </Box>
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      <Modal
        open={columnsModalOpen}
        onClose={() => setColumnsModalOpen(false)}
        title="Location columns"
        primaryAction={{ content: 'Done', onAction: () => setColumnsModalOpen(false) }}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <BlockStack gap="200">
              <Text tone="subdued">Choose which locations to show as columns. Hidden locations are still covered by CSV import.</Text>
              <InlineStack gap="200">
                <Button
                  variant="plain"
                  size="slim"
                  onClick={() => saveHiddenLocationIds(new Set())}
                  disabled={visibleLocations.length === locations.length}
                >
                  Select all
                </Button>
                <Button
                  variant="plain"
                  size="slim"
                  onClick={keepFirstVisibleOnly}
                  disabled={visibleLocations.length <= 1}
                >
                  Deselect all
                </Button>
              </InlineStack>
            </BlockStack>
            {locations.map((loc) => {
              const checked = visibleIdSet.has(loc.id);
              return (
                <Checkbox
                  key={loc.id}
                  label={loc.name}
                  checked={checked}
                  disabled={checked && visibleLocations.length === 1}
                  onChange={(c) => toggleLocationVisible(loc.id, c)}
                />
              );
            })}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Max Qty from CSV"
        primaryAction={{ content: 'Close', onAction: () => setImportOpen(false) }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text>
                CSV with <Text as="span" fontWeight="semibold">sku</Text> and{' '}
                <Text as="span" fontWeight="semibold">max_qty</Text> columns. Matches by exact SKU — same
                rule as every other CSV import in this app.
              </Text>
              <Text tone="subdued">
                One location per row: add an optional <Text as="span" fontWeight="semibold">location</Text> column
                (matched by location name) to cover several locations in one file — a row with no location
                column, or a blank cell, falls back to the picker below.
              </Text>
              <InlineStack gap="300">
                <Button variant="plain" onClick={() => downloadCSVFile('max-qty-import-example.csv', MAX_QTY_CSV_EXAMPLE)}>
                  Download example (single location)
                </Button>
                <Button variant="plain" onClick={() => downloadCSVFile('max-qty-import-multi-location-example.csv', MAX_QTY_CSV_MULTI_LOCATION_EXAMPLE)}>
                  Download example (multiple locations)
                </Button>
              </InlineStack>
            </BlockStack>

            <Select
              label="Default location (for rows with no location column)"
              options={[{ label: 'Select a location', value: '' }, ...locationOptions]}
              value={importLocationId}
              onChange={setImportLocationId}
            />

            {importError && <Banner tone="critical">{importError}</Banner>}
            {importResult && (
              <Banner tone={importResult.notFound.length || importResult.skipped ? 'warning' : 'success'}>
                <BlockStack gap="100">
                  <Text as="span">
                    Imported {importResult.imported}
                    {importResult.skipped ? `, skipped ${importResult.skipped}` : ''}
                    {importResult.notFound.length ? `, ${importResult.notFound.length} not found` : ''}.
                  </Text>
                  {importResult.notFound.length > 0 && (
                    <Text as="span" tone="subdued">Not found: {importResult.notFound.join(', ')}</Text>
                  )}
                  {importResult.locationNotFound?.length > 0 && (
                    <Text as="span" tone="subdued">Unknown location: {importResult.locationNotFound.join(', ')}</Text>
                  )}
                </BlockStack>
              </Banner>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={handleCsvFileSelect}
            />
            <Button onClick={() => fileInputRef.current?.click()} loading={importing} disabled={importing}>
              {importing ? 'Importing…' : 'Choose CSV file'}
            </Button>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <SkuMatchModal
        open={ambiguous.length > 0}
        items={ambiguous.map((a) => ({
          id: a.id,
          sku: a.sku,
          options: a.matches.map((m) => ({
            label: `${m.product.title}${m.product.variants.length > 1 ? ` — ${m.variant.title}` : ''}${m.product.status === 'ARCHIVED' ? ' [Archived]' : ''}`,
            value: m.variant.id,
          })),
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

      {toast && <Toast content={toast.message} onDismiss={() => setToast(null)} duration={2500} />}
    </Page>
  );
}
