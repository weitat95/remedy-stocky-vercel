import React, { useState, useCallback, useEffect } from 'react';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Autocomplete,
  Icon,
  Banner,
  Link,
  EmptyState,
} from '@shopify/polaris';
import { ImportIcon, SearchIcon, DeleteIcon } from '@shopify/polaris-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createDraftOrder } from '../../api/draftOrders.js';
import { getProducts } from '../../api/products.js';
import { parseCSV, downloadCSVFile } from '../../utils/csv.js';
import SkuMatchModal from '../../components/SkuMatchModal.jsx';
import ArchivedSkuModal from '../../components/ArchivedSkuModal.jsx';

function matchLabel(product, variant) {
  const name = product.variants.length === 1 ? product.title : `${product.title} — ${variant.title}`;
  const archivedTag = product.status === 'ARCHIVED' ? ' [Archived]' : '';
  return `${name} (SKU: ${variant.sku})${archivedTag}`;
}

const DRAFT_ORDER_CSV_EXAMPLE = [
  ['sku', 'quantity'],
  ['SKU-001', '10'],
  ['SKU-002', '5'],
];

// { shopifyVariantId, productTitle, variantTitle, sku, quantity }
const EMPTY_LINE_ITEM = { shopifyVariantId: '', productTitle: '', variantTitle: '', sku: '', quantity: '' };

export default function DraftOrders() {
  const [formError, setFormError] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [created, setCreated] = useState([]); // draft orders created this session

  // CSV import
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState(null); // { added, skipped, notFound }
  const [archivedModalSkus, setArchivedModalSkus] = useState([]);

  // Ambiguous SKU matches (duplicate SKU across active products)
  const [ambiguous, setAmbiguous] = useState([]); // [{ id, sku, quantity, matches: [{product, variant}] }]
  const [ambiguousSelections, setAmbiguousSelections] = useState({});

  const buildRowFromMatch = useCallback((product, variant, quantity) => ({
    shopifyVariantId: variant.id,
    productTitle: product.title,
    variantTitle: product.variants.length === 1 ? '' : variant.title,
    sku: variant.sku ?? '',
    quantity,
  }), []);

  const handleCsvFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setCsvImporting(true);
    setCsvResult(null);
    setFormError(null);
    try {
      const rows = parseCSV(await file.text());
      if (rows.length === 0) return;
      const firstRow = rows[0];
      const qtyKey = 'quantity' in firstRow ? 'quantity' : 'qty' in firstRow ? 'qty' : null;
      if (!('sku' in firstRow) || !qtyKey) {
        setFormError('CSV must have "sku" and "quantity" columns.');
        return;
      }
      const lookups = await Promise.all(
        rows.map(async (row) => {
          const sku = row.sku?.trim();
          if (!sku) return null;
          const quantity = row[qtyKey]?.trim() ?? '';
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
          if (matches.length > 1) return { id: crypto.randomUUID(), sku, kind: 'ambiguous', quantity, matches };
          const { product, variant } = matches[0];
          if (product.status === 'ARCHIVED') return { sku, kind: 'archived' };
          return { sku, kind: 'resolved', row: buildRowFromMatch(product, variant, quantity) };
        })
      );
      let added = 0, skipped = 0;
      const notFound = [];
      const archivedSkus = [];
      const toAdd = [];
      const pendingAmbiguous = [];
      const existing = new Set(lineItems.map((li) => li.shopifyVariantId).filter(Boolean));
      for (const r of lookups) {
        if (!r) continue;
        if (r.kind === 'not-found') { notFound.push(r.sku); continue; }
        if (r.kind === 'archived') { archivedSkus.push(r.sku); skipped++; continue; }
        if (r.kind === 'ambiguous') { pendingAmbiguous.push(r); continue; }
        if (existing.has(r.row.shopifyVariantId)) { skipped++; continue; }
        existing.add(r.row.shopifyVariantId);
        toAdd.push(r.row);
        added++;
      }
      if (toAdd.length > 0) {
        setLineItems((prev) => [...prev, ...toAdd]);
      }
      setCsvResult({ added, skipped, notFound });
      if (archivedSkus.length > 0) setArchivedModalSkus(archivedSkus);
      if (pendingAmbiguous.length > 0) {
        setAmbiguous(pendingAmbiguous);
        setAmbiguousSelections({});
      }
    } catch (err) {
      setFormError('CSV import failed: ' + err.message);
    } finally {
      setCsvImporting(false);
    }
  }, [lineItems, buildRowFromMatch]);

  const handleAmbiguousSelect = useCallback((id, variantId) => {
    setAmbiguousSelections((prev) => ({ ...prev, [id]: variantId }));
  }, []);

  const handleAmbiguousConfirm = useCallback(() => {
    const existing = new Set(lineItems.map((li) => li.shopifyVariantId).filter(Boolean));
    const toAdd = [];
    let added = 0, skipped = 0;
    const archivedSkus = [];
    for (const a of ambiguous) {
      const variantId = ambiguousSelections[a.id];
      const match = variantId && a.matches.find((m) => m.variant.id === variantId);
      if (!match) { skipped++; continue; }
      if (match.product.status === 'ARCHIVED') { archivedSkus.push(a.sku); skipped++; continue; }
      if (existing.has(match.variant.id)) { skipped++; continue; }
      existing.add(match.variant.id);
      toAdd.push(buildRowFromMatch(match.product, match.variant, a.quantity));
      added++;
    }
    if (toAdd.length > 0) {
      setLineItems((prev) => [...prev, ...toAdd]);
    }
    setCsvResult((prev) => prev
      ? { ...prev, added: prev.added + added, skipped: prev.skipped + skipped }
      : { added, skipped, notFound: [] });
    if (archivedSkus.length > 0) setArchivedModalSkus((prev) => [...prev, ...archivedSkus]);
    setAmbiguous([]);
    setAmbiguousSelections({});
  }, [ambiguous, ambiguousSelections, lineItems, buildRowFromMatch]);

  const handleAmbiguousCancel = useCallback(() => {
    setCsvResult((prev) => prev
      ? { ...prev, skipped: prev.skipped + ambiguous.length }
      : { added: 0, skipped: ambiguous.length, notFound: [] });
    setAmbiguous([]);
    setAmbiguousSelections({});
  }, [ambiguous]);

  // Variant search for manual line item entry
  const [variantSearch, setVariantSearch] = useState('');
  const [variantOptions, setVariantOptions] = useState([]);

  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ['draft-order-variant-search', variantSearch],
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
          label: product.variants.length === 1 ? product.title : `${product.title} — ${v.title}`,
          meta: {
            shopifyVariantId: v.id,
            productTitle: product.title,
            variantTitle: product.variants.length === 1 ? '' : v.title,
            sku: v.sku ?? '',
          },
        });
      }
    }
    setVariantOptions(opts);
  }, [searchData]);

  const handleSelectVariant = useCallback((selected) => {
    const opt = variantOptions.find((o) => o.value === selected[0]);
    if (!opt) return;
    setLineItems((prev) => {
      if (prev.some((li) => li.shopifyVariantId === opt.meta.shopifyVariantId)) return prev;
      return [...prev, { ...opt.meta, quantity: '' }];
    });
    setVariantSearch('');
    setVariantOptions([]);
  }, [variantOptions]);

  const handleRemoveLineItem = useCallback((variantId) => {
    setLineItems((prev) => prev.filter((li) => li.shopifyVariantId !== variantId));
  }, []);

  const handleLineItemChange = useCallback((variantId, field, value) => {
    setLineItems((prev) =>
      prev.map((item) => (item.shopifyVariantId === variantId ? { ...item, [field]: value } : item))
    );
  }, []);

  const createMutation = useMutation({
    mutationFn: createDraftOrder,
    onSuccess: (draftOrder) => {
      setCreated((prev) => [draftOrder, ...prev]);
      setLineItems([]);
      setCsvResult(null);
    },
    onError: (err) => setFormError(err.message),
  });

  const handleCreate = useCallback(() => {
    setFormError(null);
    const validItems = lineItems.filter((li) => li.shopifyVariantId && Number(li.quantity) > 0);
    if (validItems.length === 0) {
      setFormError('Add at least one variant with a quantity.');
      return;
    }
    createMutation.mutate(
      validItems.map((li) => ({ shopifyVariantId: li.shopifyVariantId, quantity: Number(li.quantity) }))
    );
  }, [lineItems, createMutation]);

  return (
    <Page
      title="Draft Orders"
      primaryAction={{
        content: 'Create Draft Order',
        onAction: handleCreate,
        loading: createMutation.isPending,
        disabled: lineItems.filter((li) => li.shopifyVariantId).length === 0,
      }}
    >
      <Layout>
        {formError && (
          <Layout.Section>
            <Banner tone="critical" title="Error" onDismiss={() => setFormError(null)}>
              <p>{formError}</p>
            </Banner>
          </Layout.Section>
        )}

        {created.length > 0 && (
          <Layout.Section>
            <BlockStack gap="200">
              {created.map((d) => (
                <Banner key={d.id} tone="success" title={`Draft order ${d.name} created`}>
                  <Link url={d.invoiceUrl} target="_blank" removeUnderline>
                    View in Shopify Admin
                  </Link>
                </Banner>
              ))}
            </BlockStack>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {csvResult && (
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
              )}

              <InlineStack gap="200" blockAlign="center">
                <input
                  id="draft-order-csv-input"
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={handleCsvFileSelect}
                />
                <Button
                  icon={ImportIcon}
                  loading={csvImporting}
                  onClick={() => document.getElementById('draft-order-csv-input')?.click()}
                >
                  Import line items from CSV
                </Button>
                <Button
                  variant="plain"
                  onClick={() => downloadCSVFile('draft-order-import-example.csv', DRAFT_ORDER_CSV_EXAMPLE)}
                >
                  Download example
                </Button>
              </InlineStack>

              <Autocomplete
                options={variantOptions}
                selected={[]}
                onSelect={handleSelectVariant}
                loading={searching}
                textField={
                  <Autocomplete.TextField
                    label="Add variant"
                    labelHidden
                    value={variantSearch}
                    onChange={setVariantSearch}
                    prefix={<Icon source={SearchIcon} />}
                    placeholder="Search by product title to add a variant…"
                    autoComplete="off"
                  />
                }
              />

              {lineItems.length === 0 ? (
                <EmptyState
                  heading="No line items yet"
                  image=""
                >
                  <p>Import a CSV of SKUs and quantities, or search above to add variants.</p>
                </EmptyState>
              ) : (
                <BlockStack gap="300">
                  {lineItems.map((item) => (
                    <InlineStack key={item.shopifyVariantId} align="space-between" blockAlign="center" gap="300">
                      <BlockStack gap="050">
                        <Text variant="bodyMd" fontWeight="semibold">
                          {item.productTitle}{item.variantTitle ? ` — ${item.variantTitle}` : ''}
                        </Text>
                        <Text variant="bodySm" tone="subdued">{item.sku || item.shopifyVariantId}</Text>
                      </BlockStack>
                      <InlineStack gap="200" blockAlign="center">
                        <div style={{ width: 80 }}>
                          <TextField
                            label="Qty"
                            labelHidden
                            type="number"
                            value={item.quantity}
                            onChange={(v) => handleLineItemChange(item.shopifyVariantId, 'quantity', v)}
                            autoComplete="off"
                            min="1"
                          />
                        </div>
                        <Button
                          icon={DeleteIcon}
                          variant="plain"
                          tone="critical"
                          onClick={() => handleRemoveLineItem(item.shopifyVariantId)}
                        />
                      </InlineStack>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

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
