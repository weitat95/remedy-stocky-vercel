import React, { useState, useCallback } from 'react';
import {
  Page, Card, ResourceList, ResourceItem, Text,
  Button, Modal, FormLayout, TextField, Banner, Spinner,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSuppliers, createSupplier, deleteSupplier } from '../../api/suppliers.js';

export default function Suppliers() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', leadDays: '7' });

  const { data, isLoading, error } = useQuery({ queryKey: ['suppliers'], queryFn: getSuppliers });

  const createMutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setModalOpen(false);
      setForm({ name: '', email: '', phone: '', leadDays: '7' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSupplier,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  });

  const handleSubmit = useCallback(() => {
    createMutation.mutate({ ...form, leadDays: Number(form.leadDays) });
  }, [form, createMutation]);

  const suppliers = data?.data || [];

  return (
    <Page
      title="Suppliers"
      primaryAction={{ content: 'Add supplier', onAction: () => setModalOpen(true) }}
    >
      {error && <Banner tone="critical">{error.message}</Banner>}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <ResourceList
            resourceName={{ singular: 'supplier', plural: 'suppliers' }}
            items={suppliers}
            renderItem={(supplier) => (
              <ResourceItem
                id={supplier.id}
                shortcutActions={[
                  { content: 'Delete', destructive: true, onAction: () => deleteMutation.mutate(supplier.id) },
                ]}
              >
                <Text variant="bodyMd" fontWeight="bold">{supplier.name}</Text>
                <Text variant="bodySm" tone="subdued">{supplier.email || '—'} · Lead time: {supplier.leadDays}d</Text>
              </ResourceItem>
            )}
          />
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add supplier"
        primaryAction={{ content: 'Save', onAction: handleSubmit, loading: createMutation.isPending }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setModalOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField label="Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} autoComplete="off" />
            <TextField label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} autoComplete="off" />
            <TextField label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} autoComplete="off" />
            <TextField label="Lead time (days)" type="number" value={form.leadDays} onChange={(v) => setForm((f) => ({ ...f, leadDays: v }))} autoComplete="off" />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
