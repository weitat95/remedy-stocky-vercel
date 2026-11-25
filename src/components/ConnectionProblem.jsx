import React, { useEffect, useRef } from 'react';
import { Box, Card, BlockStack, Text, Button } from '@shopify/polaris';
import useOnlineStatus from '../hooks/useOnlineStatus.js';

// Shown when the session check can't reach the server at all (no network, server down). That is not
// "logged out", so don't send the user to the login form; offer a retry, and retry by itself when the
// browser reports the network coming back (only that transition, never on mount, or a dead server
// would be retried in a loop).
export default function ConnectionProblem({ onRetry, retrying }) {
  const online = useOnlineStatus();
  const wasOffline = useRef(!online);
  useEffect(() => {
    if (online && wasOffline.current) onRetry();
    wasOffline.current = !online;
  }, [online, onRetry]);
  return (
    <Box minHeight="100vh" background="bg-surface-secondary" padding="400">
      <Box paddingBlockStart="2000" style={{ maxWidth: 400, marginInline: 'auto' }}>
        <Card>
          <BlockStack gap="300">
            <Text variant="headingLg" as="h1">Can't connect</Text>
            <Text as="p" tone="subdued">
              {online ? "The server isn't responding. Check the connection and try again in a moment." : "You're offline. It will reconnect on its own when the network is back."}
            </Text>
            <Button variant="primary" onClick={onRetry} loading={retrying}>Try again</Button>
          </BlockStack>
        </Card>
      </Box>
    </Box>
  );
}
