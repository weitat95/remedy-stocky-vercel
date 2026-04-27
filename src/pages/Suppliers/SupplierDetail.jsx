import React, { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Page, Layout, Card, ResourceList, ResourceItem, Text,
  Button, Modal, TextField, Banner, Spinner, BlockStack,
  InlineStack, Badge, EmptyState, Thumbnail, FormLayout,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupplier, updateSupplier, assignProduct, unassignProduct } from '../../api/suppliers.js';
import apiClient from '../../api/client.js';

async function searchProducts(search) {
  const params = search ? { search, searchBy: 'title', first: 30 } : { first: 30 };
  const res = await apiClient.get('/products', { params });
  return res.data.data?.products ?? [];
}

export default function SupplierDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const { data: supplier, isLoading, error } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => getSupplier(id),
  });

  const updateMutation = useMutation({
    mutationFn: (payload) => updateSupplier(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      setEditOpen(false);
    },
  });

  const assignMutation = useMutation({
    mutationFn: (product) =>
      assignProduct(id, {
        shopifyProductId: product.id,
        productTitle: product.title,
        productVendor: product.vendor || null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supplier', id] }),
  });

  const unassignMutation = useMutation({
    mutationFn: (recordId) => unassignProduct(id, recordId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supplier', id] }),
  });

  const openEdit = useCallback(() => {
    setEditForm({
      name: supplier?.name ?? '',
      email: supplier?.email ?? '',
      phone: supplier?.phone ?? '',
      leadDays: String(supplier?.leadDays ?? 7),
    });
    setEditOpen(true);
  }, [supplier]);

  const handleSearch = useCallback(async (val) => {
    setSearch(val);
    setSearching(true);
    try {
      const results = await searchProducts(val);
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  }, []);

  const openAdd = useCallback(() => {
    setSearch('');
    setSearchResults([]);
    setAddOpen(true);
    handleSearch('');
  }, [handleSearch]);

  const assignedIds = useMemo(
    () => new Set((supplier?.products ?? []).map((p) => p.shopifyProductId)),
    [supplier]
  );

  if (isLoading) return <Page><Spinner /></Page>;
  if (error) return <Page><Banner tone="critical">{error.message}</Banner></Page>;

  const assignedProducts = supplier?.products ?? [];

  return (
    <Page
      title={supplier.name}
      backAction={{ content: 'Suppliers', onAction: () => navigate('/suppliers') }}
      primaryAction={{ content: 'Edit', onAction: openEdit }}
    >
      <Layout>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">Details</Text>
              <BlockStack gap="100">
                <InlineStack align="space-between">
                  <Text tone="subdued">Email</Text>
                  <Text>{supplier.email || '—'}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text tone="subdued">Phone</Text>
                  <Text>{supplier.phone || '—'}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text tone="subdued">Lead time</Text>
                  <Text>{supplier.leadDays}d</Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  Assigned products{' '}
                  {assignedProducts.length > 0 && (
                    <Badge>{String(assignedProducts.length)}</Badge>
                  )}
                </Text>
                <Button onClick={openAdd}>Add products</Button>
              </InlineStack>

              {assignedProducts.length === 0 ? (
                <EmptyState heading="No products assigned" image="">
                  <p>Add products that this supplier provides.</p>
                </EmptyState>
              ) : (
                <ResourceList
                  resourceName={{ singular: 'product', plural: 'products' }}
                  items={assignedProducts}
                  renderItem={(item) => (
                    <ResourceItem
                      id={item.id}
                      shortcutActions={[
                        {
                          content: 'Remove',
                          destructive: true,
                          onAction: () => unassignMutation.mutate(item.id),
                        },
                      ]}
                    >
                      <BlockStack gap="050">
                        <Text variant="bodyMd" fontWeight="bold">{item.productTitle}</Text>
                        {item.productVendor && (
                          <Text variant="bodySm" tone="subdued">{item.productVendor}</Text>
                        )}
                      </BlockStack>
                    </ResourceItem>
                  )}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Edit supplier modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit supplier"
        primaryAction={{
          content: 'Save',
          onAction: () =>
            updateMutation.mutate({
              name: editForm.name,
              email: editForm.email || null,
              phone: editForm.phone || null,
              leadDays: Number(editForm.leadDays),
            }),
          loading: updateMutation.isPending,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setEditOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField label="Name" value={editForm.name ?? ''} onChange={(v) => setEditForm((f) => ({ ...f, name: v }))} autoComplete="off" />
            <TextField label="Email" value={editForm.email ?? ''} onChange={(v) => setEditForm((f) => ({ ...f, email: v }))} autoComplete="off" />
            <TextField label="Phone" value={editForm.phone ?? ''} onChange={(v) => setEditForm((f) => ({ ...f, phone: v }))} autoComplete="off" />
            <TextField label="Lead time (days)" type="number" value={editForm.leadDays ?? '7'} onChange={(v) => setEditForm((f) => ({ ...f, leadDays: v }))} autoComplete="off" />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Add products modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add products"
        secondaryActions={[{ content: 'Done', onAction: () => setAddOpen(false) }]}
        large
      >
        <Modal.Section>
          <TextField
            label="Search products"
            value={search}
            onChange={handleSearch}
            autoComplete="off"
            placeholder="Type to search by title…"
            clearButton
            onClearButtonClick={() => handleSearch('')}
          />
        </Modal.Section>
        <Modal.Section>
          {searching ? (
            <InlineStack align="center"><Spinner size="small" /></InlineStack>
          ) : searchResults.length === 0 ? (
            <Text tone="subdued">No products found.</Text>
          ) : (
            <ResourceList
              resourceName={{ singular: 'product', plural: 'products' }}
              items={searchResults}
              renderItem={(product) => {
                const assigned = assignedIds.has(product.id);
                return (
                  <ResourceItem
                    id={product.id}
                    media={
                      product.thumbnailUrl ? (
                        <Thumbnail size="small" source={product.thumbnailUrl} alt={product.title} />
                      ) : undefined
                    }
                    shortcutActions={[
                      {
                        content: assigned ? 'Assigned' : 'Assign',
                        disabled: assigned,
                        onAction: () => assignMutation.mutate(product),
                      },
                    ]}
                  >
                    <BlockStack gap="050">
                      <Text variant="bodyMd" fontWeight="bold">{product.title}</Text>
                      <Text variant="bodySm" tone="subdued">
                        {product.vendor || '—'} · {product.variantCount} variant{product.variantCount !== 1 ? 's' : ''}
                      </Text>
                    </BlockStack>
                  </ResourceItem>
                );
              }}
            />
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
