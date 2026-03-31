import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Page, Card, ResourceList, ResourceItem, Text, Badge,
  Modal, FormLayout, TextField, Banner, Spinner, BlockStack,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getVendors, hideVendor, convertToSupplier, updateVendor } from '../../api/vendors.js';

export default function Vendors() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editVendor, setEditVendor] = useState(null);
  const [editForm, setEditForm] = useState({ leadDays: '', restockDays: '', orderMinQty: '', orderMaxQty: '' });

  const { data: vendors = [], isLoading, error } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => getVendors(),
  });

  const hideMutation = useMutation({
    mutationFn: hideVendor,
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

  return (
    <Page title="Vendors">
      {error && <Banner tone="critical">{error.message}</Banner>}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <ResourceList
            resourceName={{ singular: 'vendor', plural: 'vendors' }}
            items={vendors}
            renderItem={(vendor) => (
              <ResourceItem
                id={vendor.id}
                onClick={() => navigate(`/vendors/${vendor.id}`)}
                shortcutActions={[
                  {
                    content: 'Lead & restock times',
                    onAction: () => openEdit(vendor),
                  },
                  {
                    content: vendor.supplierId ? 'Already a supplier' : 'Convert to supplier',
                    disabled: !!vendor.supplierId,
                    onAction: () => convertMutation.mutate(vendor.id),
                  },
                  {
                    content: 'Hide',
                    destructive: true,
                    onAction: () => hideMutation.mutate(vendor.id),
                  },
                ]}
              >
                <BlockStack gap="100">
                  <Text variant="bodyMd" fontWeight="bold">{vendor.name}</Text>
                  <Text variant="bodySm" tone="subdued">
                    Lead: {vendor.leadDays}d · Restock: {vendor.restockDays}d
                    {vendor.supplier && <> · <Badge tone="success">Supplier: {vendor.supplier.name}</Badge></>}
                  </Text>
                </BlockStack>
              </ResourceItem>
            )}
          />
        )}
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
    </Page>
  );
}
