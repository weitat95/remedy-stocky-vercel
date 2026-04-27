import React, { useState, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Frame, Navigation, TopBar } from '@shopify/polaris';
import {
  HomeIcon,
  PersonIcon,
  LocationIcon,
  OrderIcon,
  ProductIcon,
  AdjustIcon,
  TransferIcon,
  ChartLineIcon,
  InventoryIcon,
  PackageIcon,
  StoreIcon,
} from '@shopify/polaris-icons';

import Dashboard from './pages/Dashboard/index.jsx';
import Vendors from './pages/Vendors/index.jsx';
import VendorDetail from './pages/Vendors/VendorDetail.jsx';
import Suppliers from './pages/Suppliers/index.jsx';
import SupplierDetail from './pages/Suppliers/SupplierDetail.jsx';
import Locations from './pages/Locations/index.jsx';
import PurchaseOrders from './pages/PurchaseOrders/index.jsx';
import PODetail from './pages/PurchaseOrders/PODetail.jsx';
import Orders from './pages/Orders/index.jsx';
import Products from './pages/Inventory/Products.jsx';
import Adjustments from './pages/Inventory/Adjustments.jsx';
import AdjustmentDetail from './pages/Inventory/AdjustmentDetail.jsx';
import Transfers from './pages/Transfers/index.jsx';
import Reports from './pages/Reports/index.jsx';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavActive, setMobileNavActive] = useState(false);

  const toggleMobileNav = useCallback(() => setMobileNavActive((v) => !v), []);
  const is = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const navigationMarkup = (
    <Navigation location={location.pathname}>
      <Navigation.Section
        items={[
          {
            label: 'Dashboard',
            icon: HomeIcon,
            url: '/',
            onClick: () => navigate('/'),
            selected: is('/') && location.pathname === '/',
          },
          {
            label: 'Vendors',
            icon: StoreIcon,
            url: '/vendors',
            onClick: () => navigate('/vendors'),
            selected: is('/vendors'),
          },
          {
            label: 'Suppliers',
            icon: PersonIcon,
            url: '/suppliers',
            onClick: () => navigate('/suppliers'),
            selected: is('/suppliers'),
          },
          {
            label: 'Locations',
            icon: LocationIcon,
            url: '/locations',
            onClick: () => navigate('/locations'),
            selected: is('/locations'),
          },
          {
            label: 'Purchases',
            icon: PackageIcon,
            url: '/purchase-orders',
            onClick: () => navigate('/purchase-orders'),
            selected: is('/purchase-orders'),
          },
          {
            label: 'Orders',
            icon: OrderIcon,
            url: '/orders',
            onClick: () => navigate('/orders'),
            selected: is('/orders'),
          },
        ]}
      />
      <Navigation.Section
        title="Inventory"
        items={[
          {
            label: 'Products',
            icon: ProductIcon,
            url: '/inventory/products',
            onClick: () => navigate('/inventory/products'),
            selected: is('/inventory/products'),
          },
          {
            label: 'Adjustments',
            icon: AdjustIcon,
            url: '/inventory/adjustments',
            onClick: () => navigate('/inventory/adjustments'),
            selected: is('/inventory/adjustments'),
          },
          {
            label: 'Transfers',
            icon: TransferIcon,
            url: '/transfers',
            onClick: () => navigate('/transfers'),
            selected: is('/transfers'),
          },
        ]}
      />
      <Navigation.Section
        title="Reports"
        items={[
          {
            label: 'ABC Analysis',
            icon: ChartLineIcon,
            url: '/reports/abc',
            onClick: () => navigate('/reports/abc'),
            selected: is('/reports/abc'),
          },
          {
            label: 'Best Sellers',
            icon: ChartLineIcon,
            url: '/reports/best-sellers',
            onClick: () => navigate('/reports/best-sellers'),
            selected: is('/reports/best-sellers'),
          },
          {
            label: 'Low Stock',
            icon: InventoryIcon,
            url: '/reports/low-stock',
            onClick: () => navigate('/reports/low-stock'),
            selected: is('/reports/low-stock'),
          },
          {
            label: 'Orders',
            icon: OrderIcon,
            url: '/reports/orders',
            onClick: () => navigate('/reports/orders'),
            selected: is('/reports/orders'),
          },
          {
            label: 'Purchase Orders',
            icon: PackageIcon,
            url: '/reports/purchase-orders',
            onClick: () => navigate('/reports/purchase-orders'),
            selected: is('/reports/purchase-orders'),
          },
          {
            label: 'Stock on Hand',
            icon: InventoryIcon,
            url: '/reports/stock-on-hand',
            onClick: () => navigate('/reports/stock-on-hand'),
            selected: is('/reports/stock-on-hand'),
          },
          {
            label: 'Profit',
            icon: ChartLineIcon,
            url: '/reports/profit',
            onClick: () => navigate('/reports/profit'),
            selected: is('/reports/profit'),
          },
        ]}
      />
    </Navigation>
  );

  const topBarMarkup = (
    <TopBar showNavigationToggle onNavigationToggle={toggleMobileNav} />
  );

  return (
    <Frame
      topBar={topBarMarkup}
      navigation={navigationMarkup}
      showMobileNavigation={mobileNavActive}
      onNavigationDismiss={toggleMobileNav}
    >
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/vendors/:id" element={<VendorDetail />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/suppliers/:id" element={<SupplierDetail />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/purchase-orders/:id" element={<PODetail />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/inventory/products" element={<Products />} />
        <Route path="/inventory/adjustments" element={<Adjustments />} />
        <Route path="/inventory/adjustments/:id" element={<AdjustmentDetail />} />
        <Route path="/transfers/*" element={<Transfers />} />
        <Route path="/reports/*" element={<Reports />} />
      </Routes>
    </Frame>
  );
}
