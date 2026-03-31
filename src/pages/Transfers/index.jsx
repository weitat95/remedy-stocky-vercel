import React, { useState, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  ResourceList,
  ResourceItem,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  Button,
  Modal,
  FormLayout,
  TextField,
  EmptyState,
  Spinner,
  Banner,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTransfers,
  createTransfer,
  confirmTransfer,
  deleteTransfer,
} from '../../api/transfers.js';

function statusTone(status) {
  switch (status) {
    case 'received': return 'success';
    case 'in_transit': return 'info';
    case 'pending': return 'attention';
    default: return undefined;
  }
}

const EMPTY_LINE_ITEM = { shopifyVariantId: '', quantity: '' };

export default function Transfers() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState(null);

  // Form state
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [lineItems, setLineItems] = useState([{ ...EMPTY_LINE_ITEM }]);

  const { data: transfers = [], isLoading, error } = useQuery({
    queryKey: ['transfers'],
    queryFn: getTransfers,
  });

  const createMutation = useMutation({
    mutationFn: createTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      handleCloseModal();
    },
    onError: (err) => setFormError(err.message),
  });

  const confirmMutation = useMutation({
    mutationFn: (id) => confirmTransfer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
  });

  const handleOpenModal = useCallback(() => {
    setFormError(null);
    setFromLocationId('');
    setToLocationId('');
    setLineItems([{ ...EMPTY_LINE_ITEM }]);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const handleAddLineItem = useCallback(() => {
    setLineItems((prev) => [...prev, { ...EMPTY_LINE_ITEM }]);
  }, []);

  const handleRemoveLineItem = useCallback((index) => {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleLineItemChange = useCallback((index, field, value) => {
    setLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }, []);

  const handleCreateTransfer = useCallback(() => {
    setFormError(null);

    if (!fromLocationId || !toLocationId) {
      setFormError('Both source and destination location IDs are required');
      return;
    }

    const validItems = lineItems.filter((li) => li.shopifyVariantId && li.quantity);
    if (validItems.length === 0) {
      setFormError('At least one line item is required');
      return;
    }

    createMutation.mutate({
      fromLocationId,
      toLocationId,
      lineItems: validItems.map((li) => ({
        shopifyVariantId: li.shopifyVariantId,
        quantity: Number(li.quantity),
      })),
    });
  }, [fromLocationId, toLocationId, lineItems, createMutation]);

  return (
    <Page
      title="Stock Transfers"
      primaryAction={{
        content: 'New Transfer',
        onAction: handleOpenModal,
      }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Failed to load transfers">
              <p>{error.message}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <ResourceList
              resourceName={{ singular: 'transfer', plural: 'transfers' }}
              loading={isLoading}
              emptyState={
                isLoading ? (
                  <InlineStack align="center">
                    <Spinner />
                  </InlineStack>
                ) : (
                  <EmptyState
                    heading="No stock transfers"
                    action={{ content: 'New Transfer', onAction: handleOpenModal }}
                    image=""
                  >
                    <p>Create a transfer to move inventory between locations.</p>
                  </EmptyState>
                )
              }
              items={transfers}
              renderItem={(transfer) => (
                <ResourceItem
                  id={transfer.id}
                  accessibilityLabel={`Transfer from ${transfer.fromLocationId} to ${transfer.toLocationId}`}
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text variant="bodyMd" fontWeight="semibold">
                        From: {transfer.fromLocationId}
                      </Text>
                      <Text variant="bodyMd">To: {transfer.toLocationId}</Text>
                      <Text variant="bodySm" tone="subdued">
                        {transfer.lineItems?.length || 0} item(s) &middot;{' '}
                        {new Date(transfer.createdAt).toLocaleDateString()}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={statusTone(transfer.status)}>
                        {transfer.status.replace('_', ' ')}
                      </Badge>
                      {transfer.status === 'pending' && (
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            tone="success"
                            onClick={() => confirmMutation.mutate(transfer.id)}
                            loading={
                              confirmMutation.isPending &&
                              confirmMutation.variables === transfer.id
                            }
                          >
                            Confirm
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            onClick={() => deleteMutation.mutate(transfer.id)}
                            loading={
                              deleteMutation.isPending &&
                              deleteMutation.variables === transfer.id
                            }
                          >
                            Delete
                          </Button>
                        </InlineStack>
                      )}
                    </InlineStack>
                  </InlineStack>
                </ResourceItem>
              )}
            />
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        title="New Stock Transfer"
        primaryAction={{
          content: 'Create Transfer',
          onAction: handleCreateTransfer,
          loading: createMutation.isPending,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: handleCloseModal }]}
      >
        <Modal.Section>
          {formError && (
            <Banner tone="critical" title="Error">
              <p>{formError}</p>
            </Banner>
          )}
          <FormLayout>
            <TextField
              label="From Location ID"
              value={fromLocationId}
              onChange={setFromLocationId}
              autoComplete="off"
              placeholder="Shopify location ID"
            />
            <TextField
              label="To Location ID"
              value={toLocationId}
              onChange={setToLocationId}
              autoComplete="off"
              placeholder="Shopify location ID"
            />
          </FormLayout>
        </Modal.Section>

        {lineItems.map((item, index) => (
          <Modal.Section key={index}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm" as="h3">
                  Item {index + 1}
                </Text>
                {lineItems.length > 1 && (
                  <Button
                    size="slim"
                    tone="critical"
                    onClick={() => handleRemoveLineItem(index)}
                  >
                    Remove
                  </Button>
                )}
              </InlineStack>
              <FormLayout>
                <TextField
                  label="Shopify Variant ID"
                  value={item.shopifyVariantId}
                  onChange={(v) => handleLineItemChange(index, 'shopifyVariantId', v)}
                  autoComplete="off"
                />
                <TextField
                  label="Quantity"
                  type="number"
                  value={item.quantity}
                  onChange={(v) => handleLineItemChange(index, 'quantity', v)}
                  autoComplete="off"
                  min="1"
                />
              </FormLayout>
              {index === lineItems.length - 1 && (
                <Button onClick={handleAddLineItem} size="slim">
                  Add Another Item
                </Button>
              )}
            </BlockStack>
          </Modal.Section>
        ))}
      </Modal>
    </Page>
  );
}
