import React, { useState, useCallback, useRef } from 'react';
import {
  Page, Layout, Card, IndexTable, Text, Badge, Button, Thumbnail,
  InlineStack, BlockStack, Banner, Spinner, Pagination, Box,
  TextField, Select, Tabs, Modal, DropZone, Icon, Link,
  InlineGrid,
} from '@shopify/polaris';
import { SearchIcon, ExternalIcon, ChevronDownIcon, ChevronUpIcon } from '@shopify/polaris-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProducts, importVariantMeta } from '../../api/products.js';

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
    setSearch(searchDraft.trim());
  }, [searchDraft]);

  const handleSearchClear = useCallback(() => {
    setSearchDraft('');
    setSearch('');
    setCursorStack([]);
    setCursor(null);
  }, []);

  // ── Pagination ────────────────────────────────────────────────────────────
  const [cursorStack, setCursorStack] = useState([]);
  const [cursor, setCursor] = useState(null);
  const pageNum = cursorStack.length + 1;

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

  // Reset pagination on tab change
  const handleTabChange = useCallback((idx) => {
    setSelectedTab(idx);
    setCursorStack([]);
    setCursor(null);
    setSearch('');
    setSearchDraft('');
  }, []);

  // ── Query ─────────────────────────────────────────────────────────────────
  const queryKey = ['products', tab, search, searchBy, cursor];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => getProducts({
      first: 50,
      after: cursor || undefined,
      search: search || undefined,
      searchBy: search ? searchBy : undefined,
      tab,
    }),
  });

  const products = data?.products ?? [];
  const pageInfo = data?.pageInfo ?? {};
  const shopifyAdminBase = data?.shopifyAdminBase ?? '';

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
    { id: 'shopify-link', title: '' },
  ];

  return (
    <Page
      title="Products"
      subtitle="Synced from Shopify"
      primaryAction={{
        content: 'Add product',
        url: `${shopifyAdminBase}/products/new`,
        external: true,
        disabled: !shopifyAdminBase,
      }}
      secondaryActions={[
        { content: 'Import CSV', onAction: handleOpenImport },
      ]}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical">{error.message}</Banner>
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
                  hasPrevious={cursorStack.length > 0}
                  onPrevious={handlePrev}
                  hasNext={!!pageInfo.hasNextPage}
                  onNext={() => handleNext(pageInfo.endCursor)}
                  label={`Page ${pageNum}`}
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
    </Page>
  );
}

function ProductStatusBadge({ status }) {
  if (!status || status === 'ACTIVE') return null;
  const tone = status === 'DRAFT' ? 'attention' : 'critical';
  return <Badge tone={tone}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}
