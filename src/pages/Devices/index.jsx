import React, { useState, useCallback } from 'react';
import {
  Page, Card, IndexTable, Text, Badge, Button, Banner, Spinner,
  Modal, TextField, Select, Checkbox, Frame, Toast, BlockStack,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDevices, createDevice, updateDevice, deleteDevice } from '../../api/devices.js';

const UNASSIGNED = '';

// shopName is not in the form — it's derived server-side from the assigned
// Shopify location (or the deviceId when unassigned).
const emptyForm = { deviceId: '', apiKey: '', locationId: UNASSIGNED, isActive: true };

export default function Devices() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['devices'], queryFn: getDevices });

  const devices = data?.devices || [];
  const locations = data?.locations || [];

  const [toast, setToast] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // original deviceId, or null when creating
  const [form, setForm] = useState(emptyForm);
  const [currentShopName, setCurrentShopName] = useState(''); // existing shopName when editing
  const [formError, setFormError] = useState(null);

  const setField = useCallback((key) => (value) => setForm((f) => ({ ...f, [key]: value })), []);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(emptyForm);
    setCurrentShopName('');
    setFormError(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((d) => {
    setEditingId(d.deviceId);
    setForm({
      deviceId: d.deviceId,
      apiKey: d.apiKey,
      locationId: d.locationId || UNASSIGNED,
      isActive: d.isActive,
    });
    setCurrentShopName(d.shopName);
    setFormError(null);
    setModalOpen(true);
  }, []);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['devices'] });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        deviceId: form.deviceId.trim(),
        apiKey: form.apiKey.trim(),
        locationId: form.locationId || null,
        isActive: form.isActive,
      };
      return editingId ? updateDevice(editingId, payload) : createDevice(payload);
    },
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      setToast({ message: editingId ? 'Device updated' : 'Device added' });
    },
    onError: (err) => setFormError(err.message || 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (deviceId) => deleteDevice(deviceId),
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      setToast({ message: 'Device deleted' });
    },
    onError: (err) => setFormError(err.message || 'Delete failed'),
  });

  const locationOptions = [
    { label: '— Unassigned —', value: UNASSIGNED },
    ...locations.map((l) => ({ label: l.name, value: l.id })),
  ];

  const canSave = form.deviceId.trim() && form.apiKey.trim();

  // What shopName will become after save: the picked location's name, else the
  // current value (edit) or the deviceId (create).
  const selectedLocationName = locations.find((l) => l.id === form.locationId)?.name || null;
  const resultingShopName =
    selectedLocationName || currentShopName || form.deviceId.trim() || '—';

  const rows = devices.map((d, index) => (
    <IndexTable.Row id={d.deviceId} key={d.deviceId} position={index} onClick={() => openEdit(d)}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="semibold">{d.deviceId}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{d.shopName}</IndexTable.Cell>
      <IndexTable.Cell>
        {d.locationName
          ? <Text variant="bodyMd">{d.locationName}</Text>
          : <Text variant="bodyMd" tone="subdued">Unassigned</Text>}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodySm" tone="subdued" truncate>
          {d.apiKey.length > 12 ? `${d.apiKey.slice(0, 6)}…${d.apiKey.slice(-4)}` : d.apiKey}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" alignment="end" numeric>{d.eventCount ?? 0}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={d.isActive ? 'success' : undefined}>{d.isActive ? 'Active' : 'Inactive'}</Badge>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Frame>
      {toast && (
        <Toast content={toast.message} error={toast.error} onDismiss={() => setToast(null)} />
      )}
      <Page
        title="Counter devices"
        subtitle="Foot-traffic counters — map each to a Shopify location so its visits line up with that location's daily sales."
        primaryAction={{ content: 'Add device', onAction: openCreate }}
      >
        {error && <Banner tone="critical">{error.message}</Banner>}
        <Card padding="0">
          {isLoading ? (
            <div style={{ padding: 16 }}><Spinner accessibilityLabel="Loading devices" /></div>
          ) : (
            <IndexTable
              resourceName={{ singular: 'device', plural: 'devices' }}
              itemCount={devices.length}
              selectable={false}
              headings={[
                { title: 'Device ID' },
                { title: 'Shop' },
                { title: 'Location' },
                { title: 'API key' },
                { title: 'Events', alignment: 'end' },
                { title: 'Status' },
              ]}
              emptyState={
                <div style={{ padding: 24, textAlign: 'center' }}>
                  <Text tone="subdued">No devices yet. Add the counter that posts to the ingest endpoint.</Text>
                </div>
              }
            >
              {rows}
            </IndexTable>
          )}
        </Card>
      </Page>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? `Edit ${editingId}` : 'Add device'}
        primaryAction={{
          content: editingId ? 'Save' : 'Add device',
          onAction: () => saveMutation.mutate(),
          loading: saveMutation.isPending,
          disabled: !canSave,
        }}
        secondaryActions={[
          ...(editingId
            ? [{
                content: 'Delete',
                destructive: true,
                onAction: () => deleteMutation.mutate(editingId),
                loading: deleteMutation.isPending,
              }]
            : []),
          { content: 'Cancel', onAction: () => setModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {formError && (
              <Banner tone="critical" onDismiss={() => setFormError(null)}>{formError}</Banner>
            )}
            <TextField
              label="Device ID"
              value={form.deviceId}
              onChange={setField('deviceId')}
              autoComplete="off"
              helpText={
                editingId
                  ? 'Renaming updates all of this device’s counter events too. The value must match the id baked into the device firmware.'
                  : 'Must match the id baked into the device firmware.'
              }
            />
            <TextField
              label="API key"
              value={form.apiKey}
              onChange={setField('apiKey')}
              autoComplete="off"
              monospaced
              helpText="The device authenticates ingestion with this key. Changing it stops the current device from posting until it is reflashed with the new key."
            />
            <Select
              label="Shopify location"
              options={locationOptions}
              value={form.locationId}
              onChange={setField('locationId')}
              helpText={`Its foot traffic joins to this location's daily sales in the conversion report. Sets the shop name to “${resultingShopName}”.`}
            />
            <Checkbox
              label="Active"
              checked={form.isActive}
              onChange={setField('isActive')}
              helpText="Inactive devices are rejected by the ingest endpoint but keep their history."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Frame>
  );
}
