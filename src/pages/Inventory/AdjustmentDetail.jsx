import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Page, Layout, Card, FormLayout, Select, TextField, Button, Banner,
  IndexTable, Text, InlineStack, BlockStack, Box, Spinner, Badge,
  Autocomplete, Icon, Popover, ActionList, Divider, Checkbox,
} from '@shopify/polaris';
import { SearchIcon, DeleteIcon, SettingsIcon, ImportIcon } from '@shopify/polaris-icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdjustment, createAdjustment, updateAdjustment,
  saveAdjustment, archiveAdjustment, deleteAdjustment,
  getInventoryLevel,
} from '../../api/adjustments.js';
import { getLocations } from '../../api/inventory.js';
import { getProducts } from '../../api/products.js';
import { getAdjustmentReasons } from '../../api/adjustmentReasons.js';
import { parseCSV } from '../../utils/csv.js';

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
  const [reason, setReason] = useState('');
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
          const data = await getProducts({ search: sku, searchBy: 'sku', first: 1 });
          const product = data.products[0];
          if (!product) return { sku, found: false, delta: row[deltaKey]?.trim() };
          const variant = product.variants.find((v) => v.sku === sku) ?? product.variants[0];
          return {
            sku,
            found: true,
            delta: row[deltaKey]?.trim() ?? '0',
            item: {
              shopifyVariantId: variant.id,
              inventoryItemId: variant.inventoryItemId ?? '',
              productTitle: product.title,
              variantTitle: product.variants.length === 1 ? '' : variant.title,
              sku: variant.sku ?? '',
              productStatus: product.status ?? '',
              storedOldQty: null,
            },
          };
        })
      );
      let added = 0, skipped = 0;
      const notFound = [];
      const newItems = [];
      const existingSkus = new Set(lineItems.map((li) => li.sku));
      for (const r of lookups) {
        if (!r) continue;
        if (!r.found) { notFound.push(r.sku); continue; }
        if (existingSkus.has(r.item.sku)) { skipped++; continue; }
        existingSkus.add(r.item.sku);
        newItems.push({ ...r.item, delta: r.delta });
        added++;
      }
      if (newItems.length > 0) setLineItems((prev) => [...prev, ...newItems]);
      setCsvResult({ added, skipped, notFound });
    } catch (err) {
      setSaveError('CSV import failed: ' + err.message);
    } finally {
      setCsvImporting(false);
    }
  }, [lineItems]);

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

  // ── Reason combobox ───────────────────────────────────────────────────────
  const reasonOpts = reasonPresets
    .map((p) => p.label)
    .filter((r) => !reason || r.toLowerCase().includes(reason.toLowerCase()))
    .map((r) => ({ value: r, label: r }));

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
        }] : [{
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
        {csvResult && (
          <Layout.Section>
            <Banner
              tone={csvResult.notFound.length > 0 ? 'warning' : 'success'}
              onDismiss={() => setCsvResult(null)}
            >
              {csvResult.added} variant{csvResult.added !== 1 ? 's' : ''} imported
              {csvResult.skipped > 0 ? `, ${csvResult.skipped} skipped (already in list)` : ''}
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
                    <Button
                      icon={ImportIcon}
                      size="slim"
                      loading={csvImporting}
                      onClick={() => csvFileRef.current?.click()}
                    >
                      Import CSV
                    </Button>
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
                  selected={reason ? [reason] : []}
                  onSelect={(sel) => setReason(sel[0] ?? '')}
                  textField={
                    <Autocomplete.TextField
                      label="Reason"
                      value={reason}
                      onChange={setReason}
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
