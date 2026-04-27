import React, { useState, useCallback } from 'react';
import {
  Page, Layout, Card, FormLayout, TextField, Select, Checkbox,
  Button, InlineStack, BlockStack, Text, Divider, Banner,
  InlineGrid, Box,
} from '@shopify/polaris';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getSuppliers, getSupplierVariants } from '../../api/suppliers.js';
import { getLocations } from '../../api/inventory.js';
import { getTaxRates } from '../../api/taxRates.js';
import { createPurchaseOrder, updatePurchaseOrder } from '../../api/purchaseOrders.js';

const EMPTY_LINE_ITEM = {
  shopifyProductId: '',
  shopifyVariantId: '',
  supplierCode: '',
  textNote: '',
  quantity: '',
  costPrice: '',
  retailPrice: '',
  taxRate: '0',
};

const STATUS_OPTIONS = [
  { label: 'Draft', value: 'draft' },
  { label: 'Sent', value: 'sent' },
  { label: 'Partially Received', value: 'partially_received' },
  { label: 'Received', value: 'received' },
  { label: 'Cancelled', value: 'cancelled' },
];

function isoDate(d) {
  if (!d) return '';
  try { return new Date(d).toISOString().split('T')[0]; } catch { return ''; }
}

export default function POForm({ onClose, existingPO }) {
  const isEditing = Boolean(existingPO);

  const [supplierId, setSupplierId] = useState(existingPO?.supplierId || '');
  const [status, setStatus] = useState(existingPO?.status || 'draft');
  const [invoiceNo, setInvoiceNo] = useState(existingPO?.invoiceNo || '');
  const [orderNo, setOrderNo] = useState(existingPO?.orderNo || '');
  const [expectedAt, setExpectedAt] = useState(isoDate(existingPO?.expectedAt));
  const [paymentDue, setPaymentDue] = useState(isoDate(existingPO?.paymentDue));
  const [invoiceDate, setInvoiceDate] = useState(isoDate(existingPO?.invoiceDate));
  const [shipDate, setShipDate] = useState(isoDate(existingPO?.shipDate));
  const [cancelDate, setCancelDate] = useState(isoDate(existingPO?.cancelDate));
  const [shippingAddress, setShippingAddress] = useState(existingPO?.shippingAddress || '');
  const [receiveLocationId, setReceiveLocationId] = useState(existingPO?.receiveLocationId || '');
  const [adjustments, setAdjustments] = useState(String(existingPO?.adjustments ?? '0'));
  const [shippingCost, setShippingCost] = useState(String(existingPO?.shippingCost ?? '0'));
  const [paid, setPaid] = useState(existingPO?.paid || false);
  const [bulkTaxRate, setBulkTaxRate] = useState('0');
  const [lineItems, setLineItems] = useState(
    existingPO?.lineItems?.length
      ? existingPO.lineItems.map((li) => ({
          id: li.id,
          shopifyProductId: li.shopifyProductId || '',
          shopifyVariantId: li.shopifyVariantId || '',
          supplierCode: li.supplierCode || '',
          textNote: li.textNote || '',
          quantity: String(li.quantity),
          costPrice: li.costPrice != null ? String(li.costPrice) : '',
          retailPrice: li.retailPrice != null ? String(li.retailPrice) : '',
          taxRate: li.taxRate != null ? String(parseFloat(li.taxRate)) : '0',
          quantityReceived: li.quantityReceived || 0,
          // enriched
          productTitle: li.productTitle,
          variantTitle: li.variantTitle,
          sku: li.sku,
        }))
      : [{ ...EMPTY_LINE_ITEM }]
  );
  const [formError, setFormError] = useState(null);

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: getSuppliers });
  const { data: locationsRaw } = useQuery({ queryKey: ['locations'], queryFn: getLocations });
  const locationsData = locationsRaw?.data ?? [];
  const { data: taxRates = [] } = useQuery({ queryKey: ['tax-rates'], queryFn: getTaxRates });

  const taxRateOptions = [
    { label: '— No tax —', value: '0' },
    ...taxRates.map((t) => ({ label: t.name, value: String(parseFloat(t.rate)) })),
  ];

  const { data: supplierVariants = [], isFetching: loadingVariants } = useQuery({
    queryKey: ['supplier-variants', supplierId],
    queryFn: () => getSupplierVariants(supplierId),
    enabled: !isEditing && Boolean(supplierId),
  });

  const isLineItemsEmpty = lineItems.length === 1 && !lineItems[0].shopifyVariantId;

  const handleLoadSupplierProducts = useCallback(() => {
    if (!supplierVariants.length) return;
    setLineItems(
      supplierVariants.map((v) => ({
        shopifyProductId: v.shopifyProductId,
        shopifyVariantId: v.shopifyVariantId,
        productTitle: v.productTitle,
        variantTitle: v.variantTitle,
        sku: v.sku,
        supplierCode: '',
        textNote: '',
        quantity: '',
        costPrice: v.costPrice != null ? String(v.costPrice) : '',
        retailPrice: '',
        taxRate: '0',
      }))
    );
  }, [supplierVariants]);

  const supplierOptions = [
    { label: 'Select a supplier', value: '' },
    ...suppliers.map((s) => ({ label: s.name, value: s.id })),
  ];
  const locationOptions = [
    { label: '— No location —', value: '' },
    ...locationsData.map((l) => ({ label: l.name, value: l.id })),
  ];

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      isEditing ? updatePurchaseOrder(existingPO.id, payload) : createPurchaseOrder(payload),
    onSuccess: () => onClose(),
    onError: (err) => setFormError(err.message),
  });

  const handleAddLineItem = useCallback(() => setLineItems((p) => [...p, { ...EMPTY_LINE_ITEM }]), []);
  const handleRemoveLineItem = useCallback((i) => setLineItems((p) => p.filter((_, idx) => idx !== i)), []);
  const handleLineItemChange = useCallback((i, field, value) => {
    setLineItems((p) => p.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }, []);
  const handleApplyTaxToAll = useCallback(() => {
    setLineItems((p) => p.map((item) => ({ ...item, taxRate: bulkTaxRate })));
  }, [bulkTaxRate]);

  const handleSubmit = useCallback(() => {
    setFormError(null);
    if (!supplierId) { setFormError('Please select a supplier'); return; }

    const validLineItems = lineItems.filter((li) => li.shopifyVariantId && li.quantity);
    if (!isEditing && validLineItems.length === 0) {
      setFormError('Please add at least one line item');
      return;
    }

    const payload = {
      supplierId, status,
      invoiceNo: invoiceNo || null,
      orderNo: orderNo || null,
      expectedAt: expectedAt || null,
      paymentDue: paymentDue || null,
      invoiceDate: invoiceDate || null,
      shipDate: shipDate || null,
      cancelDate: cancelDate || null,
      shippingAddress: shippingAddress || null,
      receiveLocationId: receiveLocationId || null,
      adjustments: parseFloat(adjustments) || 0,
      shippingCost: parseFloat(shippingCost) || 0,
      paid,
      ...(!isEditing && {
        lineItems: validLineItems.map((li) => ({
          shopifyProductId: li.shopifyProductId || '',
          shopifyVariantId: li.shopifyVariantId,
          supplierCode: li.supplierCode || null,
          textNote: li.textNote || null,
          quantity: Number(li.quantity),
          costPrice: li.costPrice || null,
          retailPrice: li.retailPrice || null,
          taxRate: parseFloat(li.taxRate) || 0,
        })),
      }),
    };

    saveMutation.mutate(payload);
  }, [supplierId, status, invoiceNo, orderNo, expectedAt, paymentDue, invoiceDate, shipDate,
      cancelDate, shippingAddress, receiveLocationId, adjustments, shippingCost,
      paid, lineItems, isEditing, saveMutation]);

  return (
    <Page
      title={isEditing ? `Edit PO #${existingPO.poNumber || ''} — ${existingPO.supplier?.name}` : 'Create Purchase Order'}
      backAction={{ content: 'Back', onAction: onClose }}
      primaryAction={{ content: isEditing ? 'Save Changes' : 'Create PO', onAction: handleSubmit, loading: saveMutation.isPending }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Layout>
        {formError && (
          <Layout.Section>
            <Banner tone="critical" title="Error"><p>{formError}</p></Banner>
          </Layout.Section>
        )}

        {/* ── Order details ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Order Details</Text>
              <FormLayout>
                <FormLayout.Group>
                  <Select label="Supplier" options={supplierOptions} value={supplierId} onChange={setSupplierId} />
                  <Select label="Status" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField label="Invoice No." value={invoiceNo} onChange={setInvoiceNo} autoComplete="off" placeholder="INV-001" />
                  <TextField label="Supplier Order No." value={orderNo} onChange={setOrderNo} autoComplete="off" placeholder="ORD-001" />
                </FormLayout.Group>
                <FormLayout.Group>
                  <Select label="Receive Location" options={locationOptions} value={receiveLocationId} onChange={setReceiveLocationId} />
                  <TextField label="Shipping Address" value={shippingAddress} onChange={setShippingAddress} autoComplete="off" multiline={2} />
                </FormLayout.Group>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Dates ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Dates</Text>
              <FormLayout>
                <FormLayout.Group>
                  <TextField label="Expected Delivery" type="date" value={expectedAt} onChange={setExpectedAt} autoComplete="off" />
                  <TextField label="Invoice Date" type="date" value={invoiceDate} onChange={setInvoiceDate} autoComplete="off" />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField label="Ship Date" type="date" value={shipDate} onChange={setShipDate} autoComplete="off" />
                  <TextField label="Cancel Date" type="date" value={cancelDate} onChange={setCancelDate} autoComplete="off" />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField label="Payment Due" type="date" value={paymentDue} onChange={setPaymentDue} autoComplete="off" />
                </FormLayout.Group>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Finance ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Finance</Text>
              <FormLayout>
                <FormLayout.Group>
                  <TextField label="Adjustments" type="number" value={adjustments} onChange={setAdjustments} autoComplete="off" prefix="RM" />
                  <TextField label="Shipping Cost" type="number" value={shippingCost} onChange={setShippingCost} autoComplete="off" prefix="RM" />
                </FormLayout.Group>
                <Checkbox label="Paid" checked={paid} onChange={setPaid} />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Supplier products pre-fill ── */}
        {!isEditing && supplierId && supplierVariants.length > 0 && isLineItemsEmpty && (
          <Layout.Section>
            <Banner
              title={`${suppliers.find((s) => s.id === supplierId)?.name ?? 'This supplier'} has ${supplierVariants.length} variant${supplierVariants.length !== 1 ? 's' : ''} assigned`}
              action={{ content: 'Load products', loading: loadingVariants, onAction: handleLoadSupplierProducts }}
              tone="info"
            >
              <p>Pre-fill line items from this supplier's assigned products. You can remove or adjust quantities before saving.</p>
            </Banner>
          </Layout.Section>
        )}

        {/* ── Line items ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">Line Items</Text>
                {!isEditing && (
                  <InlineStack gap="200" blockAlign="end">
                    <div style={{ width: 180 }}>
                      <Select
                        label="Apply tax to all"
                        options={taxRateOptions}
                        value={bulkTaxRate}
                        onChange={setBulkTaxRate}
                      />
                    </div>
                    <Button size="slim" onClick={handleApplyTaxToAll}>Apply</Button>
                    <Button onClick={handleAddLineItem} size="slim">Add Item</Button>
                  </InlineStack>
                )}
              </InlineStack>
              <Divider />

              {lineItems.map((item, index) => (
                <Box key={index} paddingBlockEnd="400">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text variant="headingSm" as="h3">
                          {item.productTitle
                            ? `${item.productTitle}${item.variantTitle && item.variantTitle !== 'Default Title' ? ` — ${item.variantTitle}` : ''}`
                            : `Item ${index + 1}`}
                        </Text>
                        {item.sku && <Text variant="bodySm" tone="subdued">SKU: {item.sku}</Text>}
                      </BlockStack>
                      {!isEditing && lineItems.length > 1 && (
                        <Button size="slim" tone="critical" onClick={() => handleRemoveLineItem(index)}>Remove</Button>
                      )}
                    </InlineStack>

                    {!isEditing && (
                      <InlineGrid columns={2} gap="300">
                        <TextField
                          label="Shopify Variant ID"
                          value={item.shopifyVariantId}
                          onChange={(v) => handleLineItemChange(index, 'shopifyVariantId', v)}
                          autoComplete="off"
                          placeholder="gid://shopify/ProductVariant/..."
                        />
                        <TextField
                          label="Shopify Product ID"
                          value={item.shopifyProductId}
                          onChange={(v) => handleLineItemChange(index, 'shopifyProductId', v)}
                          autoComplete="off"
                          placeholder="gid://shopify/Product/..."
                        />
                      </InlineGrid>
                    )}

                    <InlineGrid columns={4} gap="300">
                      <TextField
                        label="Quantity"
                        type="number"
                        value={item.quantity}
                        onChange={(v) => handleLineItemChange(index, 'quantity', v)}
                        autoComplete="off"
                        min="1"
                        helpText={isEditing ? `Received: ${item.quantityReceived}` : undefined}
                      />
                      <TextField
                        label="Cost Price"
                        type="number"
                        value={item.costPrice}
                        onChange={(v) => handleLineItemChange(index, 'costPrice', v)}
                        autoComplete="off"
                        prefix="RM"
                        placeholder="0.00"
                      />
                      <TextField
                        label="Retail Price"
                        type="number"
                        value={item.retailPrice}
                        onChange={(v) => handleLineItemChange(index, 'retailPrice', v)}
                        autoComplete="off"
                        prefix="RM"
                        placeholder="0.00"
                      />
                      <Select
                        label="Tax"
                        options={taxRateOptions}
                        value={item.taxRate ?? '0'}
                        onChange={(v) => handleLineItemChange(index, 'taxRate', v)}
                        disabled={isEditing}
                      />
                    </InlineGrid>
                    <InlineGrid columns={2} gap="300">
                      <TextField
                        label="Supplier Code"
                        value={item.supplierCode}
                        onChange={(v) => handleLineItemChange(index, 'supplierCode', v)}
                        autoComplete="off"
                      />
                      <TextField
                        label="Text 1"
                        value={item.textNote}
                        onChange={(v) => handleLineItemChange(index, 'textNote', v)}
                        autoComplete="off"
                      />
                    </InlineGrid>
                    {index < lineItems.length - 1 && <Divider />}
                  </BlockStack>
                </Box>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
