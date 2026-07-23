import React, { useState, useCallback } from 'react';
import { Box, Card, FormLayout, TextField, Button, Text, Banner, BlockStack } from '@shopify/polaris';
import { login } from '../api/auth.js';

export default function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(username, password);
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.status === 401 ? 'Invalid username or password' : (err.message || 'Login failed'));
    } finally {
      setLoading(false);
    }
  }, [username, password, onLoginSuccess]);

  return (
    <Box
      minHeight="100vh"
      background="bg-surface-secondary"
      padding="400"
    >
      <Box paddingBlockStart="2000" style={{ maxWidth: 400, marginInline: 'auto' }}>
        <Card>
          <form onSubmit={handleSubmit}>
            <BlockStack gap="400">
              <Text variant="headingLg" as="h1">Stocky</Text>
              {error && <Banner tone="critical">{error}</Banner>}
              <FormLayout>
                <TextField
                  label="Username"
                  value={username}
                  onChange={setUsername}
                  autoComplete="username"
                  disabled={loading}
                />
                <TextField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                  disabled={loading}
                />
                <Button submit variant="primary" fullWidth loading={loading}>
                  Log in
                </Button>
              </FormLayout>
            </BlockStack>
          </form>
        </Card>
      </Box>
    </Box>
  );
}
