import React, { useState, useCallback, useRef } from 'react';
import {
  Page, Layout, Card, IndexTable, Text, Badge, Button, Thumbnail,
  InlineStack, BlockStack, Banner, Spinner, Pagination, Box,
  TextField, Select, Tabs, Modal, DropZone, Icon, Link,
  InlineGrid, Checkbox,
} from '@shopify/polaris';
import { SearchIcon, ExternalIcon, ChevronDownIcon, ChevronUpIcon } from '@shopify/polaris-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProducts, importVariantMeta, exportProducts } from '../../api/products.js';
import { getLocations } from '../../api/inventory.js';
import { downloadCSVFile } from '../../utils/csv.js';

const VISIBLE_LOCATIONS_STORAGE_KEY = 'productsVisibleLocationIds';

const SEARCH_BY_OPTIONS = [
  { label: 'Title', value: 'title' },
  { label: 'SKU', value: 'sku' },
  { label: 'Barcode', value: 'barcode' },
  { label: 'Vendor', value: 'vendor' },
];

const TABS = [
  { id: 'all', content: 'All' },
  { id: 'bundles', content: 'Bundles' },
];

// Parse CSV text into array of objects using first row as headers
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

export default function Products() {
  const queryClient = useQueryClient();

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [selectedTab, setSelectedTab] = useState(0);
  const tab = TABS[selectedTab].id;

  // ── Search ────────────────────────────────────────────────────────────────
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [searchBy, setSearchBy] = useState('title');

  const handleSearch = useCallback(() => {
    setCursorStack([]);
    setCursor(null);
    setClientPage(0);
    setSearch(searchDraft.trim());
  }, [searchDraft]);

  const handleSearchClear = useCallback(() => {
    setSearchDraft('');
    setSearch('');
    setCursorStack([]);
    setCursor(null);
    setClientPage(0);
  }, []);

  // ── Pagination ────────────────────────────────────────────────────────────
  const [cursorStack, setCursorStack] = useState([]);
  const [cursor, setCursor] = useState(null);
  const pageNum = cursorStack.length + 1;

  // ── Location column sort ─────────────────────────────────────────────────
  // Shopify has no per-location sort key, so sorting fetches the whole filtered
  // catalog once (see GET /products?sortLocationId=...) and pagination becomes a
  // client-side slice over that full list instead of Shopify cursor pagination.
  const [sortLocationId, setSortLocationId] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [clientPage, setClientPage] = useState(0);
  const isSorting = !!sortLocationId;

  const handleNext = useCallback((endCursor) => {
    if (isSorting) {
      setClientPage((p) => p + 1);
      return;
    }
    setCursorStack((prev) => [...prev, cursor]);
    setCursor(endCursor);
  }, [cursor, isSorting]);

  const handlePrev = useCallback(() => {
    if (isSorting) {
      setClientPage((p) => Math.max(0, p - 1));
      return;
    }
    setCursorStack((prev) => {
      const next = [...prev];
      setCursor(next.pop() ?? null);
      return next;
    });
  }, [isSorting]);

  // Reset pagination on tab change
  const handleTabChange = useCallback((idx) => {
    setSelectedTab(idx);
    setCursorStack([]);
    setCursor(null);
    setSearch('');
    setSearchDraft('');
    setClientPage(0);
  }, []);

  const handleSort = useCallback((headingIndex, direction, sortHeadings) => {
    const heading = sortHeadings[headingIndex];
    if (!heading?.id?.startsWith('loc-')) return;
    setSortLocationId(heading.id.slice('loc-'.length));
    setSortDir(direction === 'ascending' ? 'asc' : 'desc');
    setClientPage(0);
  }, []);

  // ── Query ─────────────────────────────────────────────────────────────────
  const queryKey = isSorting
    ? ['products', tab, search, searchBy, 'sort', sortLocationId, sortDir]
    : ['products', tab, search, searchBy, cursor];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => getProducts({
      first: isSorting ? undefined : 50,
      after: isSorting ? undefined : (cursor || undefined),
      search: search || undefined,
      searchBy: search ? searchBy : undefined,
      tab,
      sortLocationId: sortLocationId || undefined,
      sortDir: isSorting ? sortDir : undefined,
    }),
  });

  const fetchedProducts = data?.products ?? [];
  // In sort mode the backend returns the entire filtered+sorted catalog in one
  // shot; slice it into pages here instead of asking Shopify for the next page.
  const products = isSorting
    ? fetchedProducts.slice(clientPage * 50, clientPage * 50 + 50)
    : fetchedProducts;
  const pageInfo = isSorting
    ? { hasNextPage: (clientPage + 1) * 50 < fetchedProducts.length }
    : (data?.pageInfo ?? {});
  const displayPageNum = isSorting ? clientPage + 1 : pageNum;
  const hasPreviousPage = isSorting ? clientPage > 0 : cursorStack.length > 0;
  const shopifyAdminBase = data?.shopifyAdminBase ?? '';

  // ── Location columns ─────────────────────────────────────────────────────
  const { data: locationsData } = useQuery({
    queryKey: ['locations'],
    queryFn: getLocations,
  });
  const locations = locationsData?.data ?? [];

  const [visibleLocationIds, setVisibleLocationIds] = useState(() => {
    try {
      const stored = localStorage.getItem(VISIBLE_LOCATIONS_STORAGE_KEY);
      return stored ? new Set(JSON.parse(stored)) : null; // null = "show all" (no preference saved yet)
    } catch {
      return null;
    }
  });
  const visibleLocations = visibleLocationIds
    ? locations.filter((l) => visibleLocationIds.has(l.id))
    : locations;

  const [columnsModalOpen, setColumnsModalOpen] = useState(false);
  const toggleLocationVisible = useCallback((locationId, checked) => {
    setVisibleLocationIds((prev) => {
      const next = new Set(prev ?? locations.map((l) => l.id));
      checked ? next.add(locationId) : next.delete(locationId);
      localStorage.setItem(VISIBLE_LOCATIONS_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }, [locations]);

  const setAllLocationsVisible = useCallback((allVisible) => {
    const next = new Set(allVisible ? locations.map((l) => l.id) : []);
    localStorage.setItem(VISIBLE_LOCATIONS_STORAGE_KEY, JSON.stringify([...next]));
    setVisibleLocationIds(next);
  }, [locations]);

  function locationQty(variant, locationId) {
    const qty = variant.inventoryByLocation?.[locationId];
    return qty === undefined ? null : qty;
  }

  function productLocationQty(product, locationId) {
    // Sum across variants for the collapsed product row; null if not tracked anywhere
    let total = null;
    for (const variant of product.variants) {
      const qty = locationQty(variant, locationId);
      if (qty !== null) total = (total ?? 0) + qty;
    }
    return total;
  }

  // ── CSV import modal ──────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importSuccess, setImportSuccess] = useState(null);
  const fileInputRef = useRef(null);

  const importMutation = useMutation({
    mutationFn: importVariantMeta,
    onSuccess: ({ imported }) => {
      setImportSuccess(`Successfully imported ${imported} variant records.`);
      setImportError(null);
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => {
      setImportError(err.message);
    },
  });

  const handleFileDrop = useCallback((_files, accepted) => {
    const file = accepted[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const records = parseCSV(e.target.result);
        if (!records.length) {
          setImportError('CSV file is empty or has no data rows.');
          return;
        }
        importMutation.mutate(records);
      } catch {
        setImportError('Failed to parse CSV file.');
      }
    };
    reader.readAsText(file);
  }, [importMutation]);

  const handleOpenImport = useCallback(() => {
    setImportError(null);
    setImportSuccess(null);
    setImportOpen(true);
  }, []);

  // ── CSV export ────────────────────────────────────────────────────────────
  // Exports the full current search/tab result set (all matching pages, not just
  // the page on screen), with one row per variant and a column per currently
  // visible location — mirrors what's shown in the table. When a location-sort is
  // active, `fetchedProducts` already holds the entire filtered catalog in sorted
  // order (see the sort branch of GET /products) — reuse it directly instead of
  // hitting /products/export, which knows nothing about sort order and would
  // otherwise export in default Shopify order regardless of what's on screen.
  const exportMutation = useMutation({
    mutationFn: () => (isSorting
      ? Promise.resolve({ products: fetchedProducts })
      : exportProducts({
          search: search || undefined,
          searchBy: search ? searchBy : undefined,
          tab,
        })
    ),
    onSuccess: ({ products: exportedProducts }) => {
      const headerRow = [
        'Product Title', 'Variant Title', 'SKU', 'Vendor', 'Status', 'Supplier',
        ...visibleLocations.map((loc) => loc.name),
      ];
      const rows = exportedProducts.flatMap((product) => {
        const supplierNames = product.suppliers?.map((s) => s.name).join('; ') || '';
        return product.variants.map((variant) => [
          product.title,
          product.variants.length > 1 ? variant.title : '',
          variant.sku || '',
          product.vendor || '',
          product.status || '',
          supplierNames,
          ...visibleLocations.map((loc) => {
            const qty = variant.inventoryByLocation?.[loc.id];
            return qty === undefined ? '' : qty;
          }),
        ]);
      });
      downloadCSVFile(`products-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, [headerRow, ...rows]);
    },
  });

  // ── Expandable rows ───────────────────────────────────────────────────────
  const [expandedIds, setExpandedIds] = useState(new Set());
  const toggleExpanded = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // ── Table ─────────────────────────────────────────────────────────────────
  const headings = [
    { id: 'thumbnail', title: '' },
    { id: 'title', title: 'Title' },
    { id: 'sku', title: 'SKU' },
    { id: 'vendor', title: 'Vendor' },
    { id: 'supplier', title: 'Supplier' },
    ...visibleLocations.map((loc) => ({
      id: `loc-${loc.id}`,
      title: (
        <span style={{ whiteSpace: 'normal', wordBreak: 'break-word', display: 'inline-block' }}>
          {loc.name}
        </span>
      ),
      alignment: 'end',
    })),
    { id: 'shopify-link', title: '' },
  ];
  const sortableColumns = headings.map((h) => h.id.startsWith('loc-'));
  const foundSortIndex = sortLocationId ? headings.findIndex((h) => h.id === `loc-${sortLocationId}`) : -1;
  const sortColumnIndex = foundSortIndex >= 0 ? foundSortIndex : undefined;
  const activeSortDirection = sortColumnIndex !== undefined
    ? (sortDir === 'desc' ? 'descending' : 'ascending')
    : undefined;

  return (
    <Page
      fullWidth
      title="Products"
      subtitle="Synced from Shopify"
      primaryAction={{
        content: 'Add product',
        url: `${shopifyAdminBase}/products/new`,
        external: true,
        disabled: !shopifyAdminBase,
      }}
      secondaryActions={[
        { content: 'Columns', onAction: () => setColumnsModalOpen(true), disabled: !locations.length },
        { content: 'Import CSV', onAction: handleOpenImport },
        {
          content: exportMutation.isPending ? 'Exporting…' : 'Export CSV',
          onAction: () => exportMutation.mutate(),
          disabled: exportMutation.isPending,
        },
      ]}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical">{error.message}</Banner>
          </Layout.Section>
        )}
        {exportMutation.isError && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => exportMutation.reset()}>
              {exportMutation.error.message}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            {/* Tabs */}
            <Tabs tabs={TABS} selected={selectedTab} onSelect={handleTabChange} fitted />

            {/* Search bar */}
            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
              <InlineStack gap="200" blockAlign="center">
                <div style={{ width: 140 }}>
                  <Select
                    label="Search by"
                    labelHidden
                    options={SEARCH_BY_OPTIONS}
                    value={searchBy}
                    onChange={setSearchBy}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    value={searchDraft}
                    onChange={setSearchDraft}
                    placeholder={`Search by ${SEARCH_BY_OPTIONS.find((o) => o.value === searchBy)?.label.toLowerCase() ?? 'title'}…`}
                    prefix={<SearchIcon />}
                    clearButton
                    onClearButtonClick={handleSearchClear}
                    autoComplete="off"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                </div>
                <Button onClick={handleSearch}>Search</Button>
              </InlineStack>
            </Box>

            {isLoading ? (
              <Box padding="800">
                <InlineStack align="center"><Spinner /></InlineStack>
              </Box>
            ) : (
              <IndexTable
                resourceName={{ singular: 'product', plural: 'products' }}
                itemCount={products.length}
                headings={headings}
                selectable={false}
                sortable={sortableColumns}
                sortColumnIndex={sortColumnIndex}
                sortDirection={activeSortDirection}
                defaultSortDirection="descending"
                onSort={(index, direction) => handleSort(index, direction, headings)}
              >
                {products.map((product, index) => {
                  const isExpanded = expandedIds.has(product.id);
                  const singleVariant = product.variants.length === 1 ? product.variants[0] : null;
                  return (
                    <React.Fragment key={product.id}>
                      <IndexTable.Row id={product.id} position={index}>
                        {/* Thumbnail */}
                        <IndexTable.Cell flush>
                          <Box padding="200">
                            <Thumbnail
                              source={product.thumbnailUrl || ''}
                              alt={product.title}
                              size="small"
                            />
                          </Box>
                        </IndexTable.Cell>

                        {/* Title + status */}
                        <IndexTable.Cell>
                          <BlockStack gap="050">
                            <Text variant="bodyMd" fontWeight="semibold">{product.title}</Text>
                            <ProductStatusBadge status={product.status} />
                          </BlockStack>
                        </IndexTable.Cell>

                        {/* SKU */}
                        <IndexTable.Cell>
                          {singleVariant ? (
                            <Text tone="subdued">{singleVariant.sku || '—'}</Text>
                          ) : (
                            <Button
                              variant="plain"
                              size="slim"
                              icon={isExpanded ? ChevronUpIcon : ChevronDownIcon}
                              onClick={() => toggleExpanded(product.id)}
                            >
                              {product.variantCount} variants
                            </Button>
                          )}
                        </IndexTable.Cell>

                        {/* Vendor */}
                        <IndexTable.Cell>
                          <Text tone="subdued">{product.vendor || '—'}</Text>
                        </IndexTable.Cell>

                        {/* Supplier */}
                        <IndexTable.Cell>
                          {product.suppliers?.length > 0 ? (
                            <InlineStack gap="100" wrap>
                              {product.suppliers.map((s) => (
                                <Badge key={s.id} tone="info">{s.name}</Badge>
                              ))}
                            </InlineStack>
                          ) : (
                            <Text tone="subdued">—</Text>
                          )}
                        </IndexTable.Cell>

                        {/* Location quantities */}
                        {visibleLocations.map((loc) => {
                          const qty = singleVariant
                            ? locationQty(singleVariant, loc.id)
                            : productLocationQty(product, loc.id);
                          return (
                            <IndexTable.Cell key={loc.id}>
                              <Text alignment="end" as="span" tone={qty === null ? 'subdued' : undefined}>
                                {qty === null ? '—' : qty}
                              </Text>
                            </IndexTable.Cell>
                          );
                        })}

                        {/* Shopify link */}
                        <IndexTable.Cell>
                          {shopifyAdminBase && (
                            <Link
                              url={`${shopifyAdminBase}/products/${product.id.replace('gid://shopify/Product/', '')}`}
                              external
                              removeUnderline
                            >
                              <Icon source={ExternalIcon} tone="subdued" />
                            </Link>
                          )}
                        </IndexTable.Cell>
                      </IndexTable.Row>

                      {/* Variant sub-rows */}
                      {!singleVariant && isExpanded && product.variants.map((variant, vIdx) => (
                        <IndexTable.Row
                          id={`${product.id}-${variant.id}`}
                          key={variant.id}
                          position={index + vIdx + 1}
                          rowType="child"
                        >
                          <IndexTable.Cell />
                          <IndexTable.Cell>
                            <Text tone="subdued">{variant.title}</Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text tone="subdued">{variant.sku || '—'}</Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell />
                          <IndexTable.Cell />
                          {visibleLocations.map((loc) => {
                            const qty = locationQty(variant, loc.id);
                            return (
                              <IndexTable.Cell key={loc.id}>
                                <Text alignment="end" as="span" tone={qty === null ? 'subdued' : undefined}>
                                  {qty === null ? '—' : qty}
                                </Text>
                              </IndexTable.Cell>
                            );
                          })}
                          <IndexTable.Cell />
                        </IndexTable.Row>
                      ))}
                    </React.Fragment>
                  );
                })}
              </IndexTable>
            )}

            {/* Pagination */}
            <Box padding="300" borderBlockStartWidth="025" borderColor="border">
              <InlineStack align="center">
                <Pagination
                  hasPrevious={hasPreviousPage}
                  onPrevious={handlePrev}
                  hasNext={!!pageInfo.hasNextPage}
                  onNext={() => handleNext(pageInfo.endCursor)}
                  label={`Page ${displayPageNum}`}
                />
              </InlineStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>

      {/* ── CSV Import modal ─────────────────────────────────────────────── */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Stocky fields from CSV"
        primaryAction={{
          content: importMutation.isPending ? 'Importing…' : 'Close',
          onAction: () => setImportOpen(false),
          disabled: importMutation.isPending,
        }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text>
              Upload a CSV file with a <Text as="span" fontWeight="semibold">shopifyVariantId</Text> column
              plus any of: <Text as="span" tone="subdued">costPrice, avgCost, minOrder, minStock, maxStock,
              reorderPoint, binLocation, text1, text2, text3</Text>.
            </Text>

            {importError && <Banner tone="critical">{importError}</Banner>}
            {importSuccess && <Banner tone="success">{importSuccess}</Banner>}

            {!importSuccess && (
              <DropZone
                accept=".csv,text/csv"
                type="file"
                onDrop={handleFileDrop}
                disabled={importMutation.isPending}
              >
                <DropZone.FileUpload
                  actionTitle="Upload CSV"
                  actionHint="or drop a .csv file here"
                />
              </DropZone>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* ── Location columns modal ───────────────────────────────────────── */}
      <Modal
        open={columnsModalOpen}
        onClose={() => setColumnsModalOpen(false)}
        title="Location columns"
        primaryAction={{ content: 'Done', onAction: () => setColumnsModalOpen(false) }}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <BlockStack gap="200">
              <Text tone="subdued">Choose which location inventory levels to show as columns.</Text>
              <InlineStack gap="200">
                <Button
                  variant="plain"
                  size="slim"
                  onClick={() => setAllLocationsVisible(true)}
                  disabled={visibleLocations.length === locations.length}
                >
                  Select all
                </Button>
                <Button
                  variant="plain"
                  size="slim"
                  onClick={() => setAllLocationsVisible(false)}
                  disabled={visibleLocations.length === 0}
                >
                  Deselect all
                </Button>
              </InlineStack>
            </BlockStack>
            {locations.map((loc) => (
              <Checkbox
                key={loc.id}
                label={loc.name}
                checked={visibleLocations.some((l) => l.id === loc.id)}
                onChange={(checked) => toggleLocationVisible(loc.id, checked)}
              />
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function ProductStatusBadge({ status }) {
  if (!status || status === 'ACTIVE') return null;
  const tone = status === 'DRAFT' ? 'attention' : 'critical';
  return <Badge tone={tone}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}
