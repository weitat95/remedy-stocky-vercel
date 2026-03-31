import React from 'react';
import { Page, Card, ResourceList, ResourceItem, Text, Banner, Spinner } from '@shopify/polaris';
import { useQuery } from '@tanstack/react-query';
import { getLocations } from '../../api/inventory.js';

export default function Locations() {
  const { data, isLoading, error } = useQuery({ queryKey: ['locations'], queryFn: getLocations });

  const locations = data?.data || [];

  return (
    <Page title="Locations">
      {error && <Banner tone="critical">{error.message}</Banner>}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <ResourceList
            resourceName={{ singular: 'location', plural: 'locations' }}
            items={locations}
            renderItem={(loc) => (
              <ResourceItem id={loc.id}>
                <Text variant="bodyMd" fontWeight="bold">{loc.name}</Text>
                <Text variant="bodySm" tone="subdued">
                  {[loc.address?.address1, loc.address?.city, loc.address?.country].filter(Boolean).join(', ') || '—'}
                </Text>
              </ResourceItem>
            )}
          />
        )}
      </Card>
    </Page>
  );
}
