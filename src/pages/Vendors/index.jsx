import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Page, Card, IndexTable, IndexFilters, IndexFiltersMode, ChoiceList, Text, Badge,
  Modal, FormLayout, TextField, Banner, InlineStack, Button, Toast, useSetIndexFiltersMode,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getVendors, syncVendors, getVendorSyncStatus, hideVendor, unhideVendor, convertToSupplier, updateVendor } from '../../api/vendors.js';

const PAGE_SIZE = 25;
const STATUS_TABS = [
  { id: 'active', content: 'Active' },
  { id: 'hidden', content: 'Hidden' },
  { id: 'all', content: 'All' },
];
// Sortable columns, in the order they appear in the table (index → row field)
const SORT_FIELDS = ['name', 'leadDays', 'restockDays', 'orderMinQty', 'orderMaxQty', 'supplier'];

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
  const [sort, setSort] = useState({ column: 0, direction: 'ascending' });
  const [page, setPage] = useState(1);

  const { data: syncStatus } = useQuery({
    queryKey: ['vendors-sync-status'],
    queryFn: getVendorSyncStatus,
  });

  const syncMutation = useMutation({
    mutationFn: syncVendors,
    onSuccess: ({ syncedCount }) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendors-sync-status'] });
      setToast({ message: `Synced ${syncedCount} vendor${syncedCount === 1 ? '' : 's'} from Shopify` });
    },
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
  }, [vendors, query, statusTab, supplierFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const resetPage = (fn) => (v) => { fn(v); setPage(1); };
  const supplierFilterLabel = supplierFilter.map((v) => (v === 'yes' ? 'Is a supplier' : 'Not a supplier')).join(', ');
  const appliedFilters = supplierFilter.length
    ? [{ key: 'supplier', label: `Supplier: ${supplierFilterLabel}`, onRemove: () => resetPage(setSupplierFilter)([]) }]
    : [];

  return (
    <Page
      title="Vendors"
      subtitle={`Last synced: ${formatSyncedAt(syncStatus?.lastSyncedAt)}`}
      primaryAction={{
        content: 'Sync now',
        onAction: () => syncMutation.mutate(),
        loading: syncMutation.isPending,
      }}
    >
      {error && <Banner tone="critical">{error.message}</Banner>}
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
          }]}
          appliedFilters={appliedFilters}
          onClearAll={() => { setSupplierFilter([]); setQuery(''); setPage(1); }}
          sortOptions={[]}
          canCreateNewView={false}
          loading={isLoading}
        />
        <IndexTable
          resourceName={{ singular: 'vendor', plural: 'vendors' }}
          itemCount={filtered.length}
          selectable={false}
          loading={isLoading}
          headings={[
            { title: 'Vendor' },
            { title: 'Lead (days)', alignment: 'end' },
            { title: 'Restock (days)', alignment: 'end' },
            { title: 'Min order qty', alignment: 'end' },
            { title: 'Max order qty', alignment: 'end' },
            { title: 'Supplier' },
            { title: 'Actions' },
          ]}
          sortable={[true, true, true, true, true, true, false]}
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
              onClick={() => navigate(`/vendors/${vendor.id}`)}
            >
              <IndexTable.Cell>
                <InlineStack gap="200" blockAlign="center">
                  <Text variant="bodyMd" fontWeight="bold" as="span">{vendor.name}</Text>
                  {vendor.hidden && <Badge>Hidden</Badge>}
                </InlineStack>
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
