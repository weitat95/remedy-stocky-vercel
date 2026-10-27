import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Page, Card, IndexTable, IndexFilters, ChoiceList, Text, Badge,
  Modal, FormLayout, TextField, Banner, InlineStack, BlockStack, Button, Toast, useSetIndexFiltersMode, useIndexResourceState,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getVendors, syncVendors, getVendorSyncStatus, hideVendor, unhideVendor, bulkHideVendors, convertToSupplier, updateVendor } from '../../api/vendors.js';

const PAGE_SIZE = 25;
const STATUS_TABS = [
  { id: 'active', content: 'Active' },
  { id: 'hidden', content: 'Hidden' },
  { id: 'all', content: 'All' },
];
// Sortable columns, in the order they appear in the table (index → row field)
const SORT_FIELDS = ['name', 'productCount', 'activeProductCount', 'leadDays', 'restockDays', 'orderMinQty', 'orderMaxQty', 'supplier'];
const PRODUCT_STATUS_CHOICES = [
  { label: 'All products archived', value: 'archived' },
  { label: 'Has active products', value: 'active' },
  { label: 'No products in Shopify', value: 'empty' },
];
// Counts are null until the first sync, so a vendor is only classified once synced.
const isAllArchived = (v) => v.productCount > 0 && v.activeProductCount === 0;
const isEmpty = (v) => v.productCount === 0;

function formatSyncedAt(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Vendors() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editVendor, setEditVendor] = useState(null);
  const [editForm, setEditForm] = useState({ leadDays: '', restockDays: '', orderMinQty: '', orderMaxQty: '' });
  const [toast, setToast] = useState(null);

  const { data: vendors = [], isLoading, error } = useQuery({
    queryKey: ['vendors', 'all'],
    queryFn: () => getVendors({ includeHidden: true }),
  });

  const { mode, setMode } = useSetIndexFiltersMode();
  const [statusTab, setStatusTab] = useState(0);
  const [query, setQuery] = useState('');
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [productStatus, setProductStatus] = useState([]);
  const [pendingBulk, setPendingBulk] = useState(null); // { ids, hidden, warnings }
  const [sort, setSort] = useState({ column: 0, direction: 'ascending' });
  const [page, setPage] = useState(1);

  const { data: syncStatus } = useQuery({
    queryKey: ['vendors-sync-status'],
    queryFn: getVendorSyncStatus,
  });

  const syncRunning = syncStatus?.state === 'running';

  // Sync runs in the background on the server; poll its state while it's in flight.
  useEffect(() => {
    if (!syncRunning) return undefined;
    const t = setInterval(() => queryClient.invalidateQueries({ queryKey: ['vendors-sync-status'] }), 3000);
    return () => clearInterval(t);
  }, [syncRunning, queryClient]);

  // Announce the outcome when a sync we saw running finishes.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (syncRunning) { wasRunning.current = true; return; }
    if (!wasRunning.current || !syncStatus) return;
    wasRunning.current = false;
    queryClient.invalidateQueries({ queryKey: ['vendors'] });
    setToast(syncStatus.state === 'error'
      ? { message: syncStatus.error || 'Sync failed', error: true }
      : { message: 'Vendor sync finished' });
  }, [syncRunning, syncStatus, queryClient]);

  const syncMutation = useMutation({
    mutationFn: syncVendors,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendors-sync-status'] }),
    onError: (err) => setToast({ message: err.message || 'Sync failed', error: true }),
  });

  const hideMutation = useMutation({
    mutationFn: ({ id, hide }) => (hide ? hideVendor(id) : unhideVendor(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendors'] }),
  });

  const convertMutation = useMutation({
    mutationFn: convertToSupplier,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendors'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => updateVendor(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      setEditVendor(null);
    },
  });

  const openEdit = useCallback((vendor) => {
    setEditVendor(vendor);
    setEditForm({
      leadDays: String(vendor.leadDays ?? 7),
      restockDays: String(vendor.restockDays ?? 0),
      orderMinQty: String(vendor.orderMinQty ?? ''),
      orderMaxQty: String(vendor.orderMaxQty ?? ''),
    });
  }, []);

  const handleSaveEdit = useCallback(() => {
    updateMutation.mutate({
      id: editVendor.id,
      payload: {
        leadDays: Number(editForm.leadDays),
        restockDays: Number(editForm.restockDays),
        orderMinQty: editForm.orderMinQty ? Number(editForm.orderMinQty) : null,
        orderMaxQty: editForm.orderMaxQty ? Number(editForm.orderMaxQty) : null,
      },
    });
  }, [editVendor, editForm, updateMutation]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const status = STATUS_TABS[statusTab].id;
    const field = SORT_FIELDS[sort.column];
    const dir = sort.direction === 'ascending' ? 1 : -1;
    const sortValue = (v) => (field === 'supplier' ? v.supplier?.name : v[field]);
    return vendors
      .filter((v) => {
        if (status === 'active' && v.hidden) return false;
        if (status === 'hidden' && !v.hidden) return false;
        if (q && !v.name.toLowerCase().includes(q) && !v.supplier?.name.toLowerCase().includes(q)) return false;
        if (productStatus.includes('archived') && !isAllArchived(v)) return false;
        if (productStatus.includes('active') && !(v.activeProductCount > 0)) return false;
        if (productStatus.includes('empty') && !isEmpty(v)) return false;
        if (supplierFilter.includes('yes') && !supplierFilter.includes('no') && !v.supplierId) return false;
        if (supplierFilter.includes('no') && !supplierFilter.includes('yes') && v.supplierId) return false;
        return true;
      })
      .sort((a, b) => {
        const av = sortValue(a);
        const bv = sortValue(b);
        // nulls sort last in either direction
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir;
      });
  }, [vendors, query, statusTab, supplierFilter, productStatus, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Not-yet-hidden vendors whose every product is archived — the clean-up candidates.
  const archivedCandidates = useMemo(
    () => vendors.filter((v) => !v.hidden && isAllArchived(v)).length,
    [vendors],
  );

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(filtered);

  const bulkCheckMutation = useMutation({
    mutationFn: ({ ids, hidden }) => bulkHideVendors(ids, hidden, true),
    onSuccess: (res, { ids, hidden }) => setPendingBulk({ ids, hidden, warnings: res.warnings }),
    onError: (err) => setToast({ message: err.message || 'Check failed', error: true }),
  });
  const bulkHideMutation = useMutation({
    mutationFn: ({ ids, hidden }) => bulkHideVendors(ids, hidden),
    onSuccess: ({ updated }, { hidden }) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      setPendingBulk(null);
      clearSelection();
      setToast({ message: `${hidden ? 'Hid' : 'Unhid'} ${updated} vendor${updated === 1 ? '' : 's'}` });
    },
    onError: (err) => setToast({ message: err.message || 'Update failed', error: true }),
  });
  // Unhiding has nothing to warn about, so it skips the confirmation step
  const startBulk = (hidden) => {
    if (hidden) bulkCheckMutation.mutate({ ids: selectedResources, hidden });
    else bulkHideMutation.mutate({ ids: selectedResources, hidden });
  };

  const resetPage = (fn) => (v) => { fn(v); setPage(1); };
  const supplierFilterLabel = supplierFilter.map((v) => (v === 'yes' ? 'Is a supplier' : 'Not a supplier')).join(', ');
  const appliedFilters = [
    ...(supplierFilter.length
      ? [{ key: 'supplier', label: `Supplier: ${supplierFilterLabel}`, onRemove: () => resetPage(setSupplierFilter)([]) }]
      : []),
    ...(productStatus.length
      ? [{
          key: 'productStatus',
          label: `Products: ${PRODUCT_STATUS_CHOICES.find((c) => c.value === productStatus[0]).label}`,
          onRemove: () => resetPage(setProductStatus)([]),
        }]
      : []),
  ];

  return (
    <Page
      title="Vendors"
      subtitle={`Last synced: ${formatSyncedAt(syncStatus?.lastSyncedAt)}`}
      primaryAction={{
        content: syncRunning ? 'Syncing…' : 'Sync now',
        onAction: () => syncMutation.mutate(),
        loading: syncRunning || syncMutation.isPending,
      }}
    >
      <BlockStack gap="400">
      {error && <Banner tone="critical">{error.message}</Banner>}
      {syncStatus?.state === 'error' && !syncRunning && (
        <Banner tone="critical">Last sync failed: {syncStatus.error}</Banner>
      )}
      {!syncStatus?.lastSyncedAt && !syncRunning && (
        <Banner tone="info">Run “Sync now” to load product counts and find vendors with only archived products.</Banner>
      )}
      {archivedCandidates > 0 && !productStatus.includes('archived') && (
        <Banner
          tone="warning"
          action={{ content: 'Show them', onAction: () => { setProductStatus(['archived']); setStatusTab(0); setPage(1); } }}
        >
          {archivedCandidates} vendor{archivedCandidates === 1 ? ' has' : 's have'} only archived products.
        </Banner>
      )}
      <Card padding="0">
        <IndexFilters
          mode={mode}
          setMode={setMode}
          tabs={STATUS_TABS.map((t, i) => ({
            id: t.id,
            content: t.content,
            isLocked: true,
            onAction: () => { setStatusTab(i); setPage(1); },
          }))}
          selected={statusTab}
          onSelect={(i) => { setStatusTab(i); setPage(1); }}
          queryValue={query}
          queryPlaceholder="Search vendors or suppliers"
          onQueryChange={resetPage(setQuery)}
          onQueryClear={() => resetPage(setQuery)('')}
          filters={[{
            key: 'supplier',
            label: 'Supplier',
            filter: (
              <ChoiceList
                title="Supplier"
                titleHidden
                allowMultiple
                choices={[{ label: 'Is a supplier', value: 'yes' }, { label: 'Not a supplier', value: 'no' }]}
                selected={supplierFilter}
                onChange={resetPage(setSupplierFilter)}
              />
            ),
            shortcut: true,
          }, {
            key: 'productStatus',
            label: 'Products',
            filter: (
              <ChoiceList
                title="Products"
                titleHidden
                choices={PRODUCT_STATUS_CHOICES}
                selected={productStatus}
                onChange={resetPage(setProductStatus)}
              />
            ),
            shortcut: true,
          }]}
          appliedFilters={appliedFilters}
          onClearAll={() => { setSupplierFilter([]); setProductStatus([]); setQuery(''); setPage(1); }}
          sortOptions={[]}
          canCreateNewView={false}
          loading={isLoading}
        />
        <IndexTable
          resourceName={{ singular: 'vendor', plural: 'vendors' }}
          itemCount={filtered.length}
          selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
          onSelectionChange={handleSelectionChange}
          promotedBulkActions={[
            { content: 'Hide selected', onAction: () => startBulk(true) },
            { content: 'Unhide selected', onAction: () => startBulk(false) },
          ]}
          loading={isLoading}
          headings={[
            { title: 'Vendor' },
            { title: 'Products', alignment: 'end' },
            { title: 'Active', alignment: 'end' },
            { title: 'Lead (days)', alignment: 'end' },
            { title: 'Restock (days)', alignment: 'end' },
            { title: 'Min order qty', alignment: 'end' },
            { title: 'Max order qty', alignment: 'end' },
            { title: 'Supplier' },
            { title: 'Actions' },
          ]}
          sortable={[true, true, true, true, true, true, true, true, false]}
          sortDirection={sort.direction}
          sortColumnIndex={sort.column}
          onSort={(column, direction) => { setSort({ column, direction }); setPage(1); }}
          pagination={{
            hasPrevious: currentPage > 1,
            hasNext: currentPage < pageCount,
            onPrevious: () => setPage(currentPage - 1),
            onNext: () => setPage(currentPage + 1),
            label: filtered.length
              ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} of ${filtered.length}`
              : '0 vendors',
          }}
          emptyState={<Text as="p" tone="subdued">No vendors match these filters.</Text>}
        >
          {pageRows.map((vendor, index) => (
            <IndexTable.Row
              id={vendor.id}
              key={vendor.id}
              position={index}
              selected={selectedResources.includes(vendor.id)}
              onClick={() => navigate(`/vendors/${vendor.id}`)}
            >
              <IndexTable.Cell>
                <InlineStack gap="200" blockAlign="center">
                  <Text variant="bodyMd" fontWeight="bold" as="span">{vendor.name}</Text>
                  {vendor.hidden && <Badge>Hidden</Badge>}
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell><Text as="span" alignment="end" numeric>{vendor.productCount ?? '—'}</Text></IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span" alignment="end" numeric tone={isAllArchived(vendor) ? 'critical' : undefined}>
                  {vendor.activeProductCount ?? '—'}
                </Text>
              </IndexTable.Cell>
              <IndexTable.Cell><Text as="span" alignment="end" numeric>{vendor.leadDays}</Text></IndexTable.Cell>
              <IndexTable.Cell><Text as="span" alignment="end" numeric>{vendor.restockDays}</Text></IndexTable.Cell>
              <IndexTable.Cell><Text as="span" alignment="end" numeric>{vendor.orderMinQty ?? '—'}</Text></IndexTable.Cell>
              <IndexTable.Cell><Text as="span" alignment="end" numeric>{vendor.orderMaxQty ?? '—'}</Text></IndexTable.Cell>
              <IndexTable.Cell>
                {vendor.supplier ? <Badge tone="success">{vendor.supplier.name}</Badge> : <Text as="span" tone="subdued">—</Text>}
              </IndexTable.Cell>
              <IndexTable.Cell>
                {/* stop the row's navigate-on-click when using an action */}
                <div onClick={(e) => e.stopPropagation()}>
                  <InlineStack gap="100" wrap={false}>
                    <Button size="slim" onClick={() => openEdit(vendor)}>Lead & restock</Button>
                    <Button
                      size="slim"
                      disabled={!!vendor.supplierId}
                      onClick={() => convertMutation.mutate(vendor.id)}
                    >
                      {vendor.supplierId ? 'Is supplier' : 'Convert to supplier'}
                    </Button>
                    <Button
                      size="slim"
                      tone={vendor.hidden ? undefined : 'critical'}
                      onClick={() => hideMutation.mutate({ id: vendor.id, hide: !vendor.hidden })}
                    >
                      {vendor.hidden ? 'Unhide' : 'Hide'}
                    </Button>
                  </InlineStack>
                </div>
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
      </BlockStack>

      <Modal
        open={!!pendingBulk}
        onClose={() => setPendingBulk(null)}
        title={`Hide ${pendingBulk?.ids.length} vendor${pendingBulk?.ids.length === 1 ? '' : 's'}?`}
        primaryAction={{
          content: 'Hide',
          destructive: true,
          onAction: () => bulkHideMutation.mutate({ ids: pendingBulk.ids, hidden: true }),
          loading: bulkHideMutation.isPending,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setPendingBulk(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">Hidden vendors disappear from vendor pickers and can be unhidden any time from the Hidden tab.</Text>
            {pendingBulk?.warnings.length > 0 && (
              <Banner tone="warning" title={`${pendingBulk.warnings.length} of these ${pendingBulk.warnings.length === 1 ? 'has' : 'have'} linked data`}>
                <ul>
                  {pendingBulk.warnings.slice(0, 10).map((w) => (
                    <li key={w.id}>{w.name}: {w.reasons.join(', ')}</li>
                  ))}
                </ul>
                {pendingBulk.warnings.length > 10 && <Text as="p">…and {pendingBulk.warnings.length - 10} more</Text>}
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={!!editVendor}
        onClose={() => setEditVendor(null)}
        title={`Lead & restock times — ${editVendor?.name}`}
        primaryAction={{
          content: 'Save',
          onAction: handleSaveEdit,
          loading: updateMutation.isPending,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setEditVendor(null) }]}
      >
        <Modal.Section>
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="Lead time (days)"
                type="number"
                value={editForm.leadDays}
                onChange={(v) => setEditForm((f) => ({ ...f, leadDays: v }))}
                autoComplete="off"
              />
              <TextField
                label="Restock time (days)"
                type="number"
                value={editForm.restockDays}
                onChange={(v) => setEditForm((f) => ({ ...f, restockDays: v }))}
                autoComplete="off"
              />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField
                label="Min order qty"
                type="number"
                value={editForm.orderMinQty}
                onChange={(v) => setEditForm((f) => ({ ...f, orderMinQty: v }))}
                autoComplete="off"
              />
              <TextField
                label="Max order qty"
                type="number"
                value={editForm.orderMaxQty}
                onChange={(v) => setEditForm((f) => ({ ...f, orderMaxQty: v }))}
                autoComplete="off"
              />
            </FormLayout.Group>
          </FormLayout>
        </Modal.Section>
      </Modal>

      {toast && (
        <Toast content={toast.message} error={toast.error} onDismiss={() => setToast(null)} />
      )}
    </Page>
  );
}
