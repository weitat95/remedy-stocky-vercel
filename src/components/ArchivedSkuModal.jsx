import React from 'react';
import { Modal, BlockStack, Text, List } from '@shopify/polaris';

// Shown after CSV import when one or more resolved SKUs turned out to belong to
// an archived (discontinued) product. Those rows are never imported automatically
// — this surfaces exactly which SKUs were rejected so the user can double check
// the CSV or re-activate the product in Shopify if it was intentional.
export default function ArchivedSkuModal({ open, skus, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Archived products skipped"
      primaryAction={{ content: 'OK', onAction: onClose }}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text tone="subdued">
            These SKUs matched an archived product and were not imported:
          </Text>
          <List type="bullet">
            {skus.map((sku) => <List.Item key={sku}>{sku}</List.Item>)}
          </List>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
