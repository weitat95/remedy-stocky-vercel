import React from 'react';
import { Modal, BlockStack, Select, Text } from '@shopify/polaris';

// Shown during CSV import when a SKU matches more than one product/variant
// (e.g. a duplicated SKU across products) — lets the user pick the right one per
// SKU instead of silently importing whichever result Shopify happened to rank first.
//
// items: [{ id, sku, options: [{ label, value }] }] — id (not sku) keys the
// selection, since two different CSV rows can carry the identical ambiguous SKU;
// keying by sku alone would make both rows share one Select's state.
// selections: { [id]: value }
export default function SkuMatchModal({ open, items, selections, onSelect, onConfirm, onCancel, confirmLoading }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Multiple matches found"
      primaryAction={{
        content: 'Add selected',
        onAction: onConfirm,
        loading: confirmLoading,
      }}
      secondaryActions={[{ content: 'Skip these', onAction: onCancel }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text tone="subdued">
            These SKUs matched more than one product. Pick which one to import for each — any left unset will be skipped.
          </Text>
          {items.map((it) => (
            <Select
              key={it.id}
              label={`SKU "${it.sku}"`}
              options={[{ label: 'Skip this SKU', value: '' }, ...it.options]}
              value={selections[it.id] ?? ''}
              onChange={(v) => onSelect(it.id, v)}
            />
          ))}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
