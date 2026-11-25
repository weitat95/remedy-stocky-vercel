import React, { useState, useCallback, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Banner, Box, Frame, Navigation, TopBar } from '@shopify/polaris';
import useOnlineStatus from './hooks/useOnlineStatus.js';
import ConnectionProblem from './components/ConnectionProblem.jsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HomeIcon,
  PersonIcon,
  LocationIcon,
  OrderIcon,
  OrderDraftIcon,
  ProductIcon,
  MaximizeIcon,
  CalendarTimeIcon,
  AdjustIcon,
  TransferIcon,
  ChartLineIcon,
  InventoryIcon,
  PackageIcon,
  StoreIcon,
  WifiIcon,
  RefreshIcon,
  PrintIcon,
} from '@shopify/polaris-icons';

import { getMe, logout as logoutApi } from './api/auth.js';
import useLogoSrc from './hooks/useLogoSrc.js';
import Login from './pages/Login.jsx';
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
import MaxQuantity from './pages/MaxQuantity/index.jsx';
import PriceScheduler from './pages/PriceScheduler/index.jsx';
import Consignment from './pages/Consignment/index.jsx';
import SalesByVendor from './pages/SalesByVendor/index.jsx';
import VendorRrp from './pages/VendorRrp/index.jsx';
import Labels from './pages/Labels/index.jsx';
import VendorMargins from './pages/VendorMargins/index.jsx';
import Adjustments from './pages/Inventory/Adjustments.jsx';
import AdjustmentDetail from './pages/Inventory/AdjustmentDetail.jsx';
import Transfers from './pages/Transfers/index.jsx';
import DraftOrders from './pages/DraftOrders/index.jsx';
import Devices from './pages/Devices/index.jsx';
import Reports from './pages/Reports/index.jsx';
import Users from './pages/Users/index.jsx';
import Tasks from './pages/Tasks/index.jsx';

const APP_TITLE = 'Stocky';

// Longest matching prefix wins, so list specific paths freely.
const PAGE_TITLES = {
  '/': 'Dashboard',
  '/vendors': 'Vendors',
  '/suppliers': 'Suppliers',
  '/locations': 'Locations',
  '/devices': 'Devices',
  '/users': 'Users',
  '/tasks': 'Tasks',
  '/purchase-orders': 'Purchases',
  '/orders': 'Orders',
  '/draft-orders': 'Draft Orders',
  '/inventory/products': 'Products',
  '/inventory/max-quantity': 'Max Quantity',
  '/inventory/labels': 'Labels',
  '/inventory/vendor-rrp': 'Vendor RRP',
  '/inventory/vendor-margins': 'Vendor Margins',
  '/inventory/adjustments': 'Adjustments',
  '/price-scheduler': 'Price Scheduler',
  '/transfers': 'Transfers',
  '/consignment': 'Consignment',
  '/consignment/sales-by-vendor': 'Sales by Vendor',
  '/reports': 'Reports',
  '/reports/low-stock': 'Low Stock',
  '/reports/reorder': 'Reorder',
  '/reports/stock-on-hand': 'Stock on Hand',
  '/reports/purchase-orders': 'Purchase Orders Report',
  '/reports/foot-traffic': 'Foot Traffic',
  '/reports/popular-times': 'Popular Times',
  '/reports/replenishment': 'Replenishment',
  '/reports/abc': 'ABC Analysis',
  '/reports/best-sellers': 'Best Sellers',
  '/reports/orders': 'Orders Report',
  '/reports/profit': 'Profit',
};

function titleForPath(pathname) {
  let best = null;
  for (const p of Object.keys(PAGE_TITLES)) {
    const match = p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`);
    if (match && (best === null || p.length > best.length)) best = p;
  }
  return best ? `${PAGE_TITLES[best]} — ${APP_TITLE}` : `${APP_TITLE} — Inventory Manager`;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const online = useOnlineStatus();

  useEffect(() => {
    document.title = titleForPath(location.pathname);
  }, [location.pathname]);
  const [mobileNavActive, setMobileNavActive] = useState(false);
  const [userMenuActive, setUserMenuActive] = useState(false);
  const topBarLogoSrc = useLogoSrc('white'); // TopBar background is dark
  const faviconLogoSrc = useLogoSrc('black'); // browser tab chrome is typically light

  // Swap the favicon to the uploaded logo once it's confirmed to exist; otherwise
  // leave index.html's default favicon.svg link untouched.
  useEffect(() => {
    if (!faviconLogoSrc) return;
    let link = document.querySelector("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = faviconLogoSrc.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg';
    link.href = faviconLogoSrc;
  }, [faviconLogoSrc]);

  // Session check — GET /auth/me returns 401 if the httpOnly cookie is missing/expired.
  const { data: session, isLoading: sessionLoading, error: sessionError, refetch: refetchSession } = useQuery({
    queryKey: ['auth-me'],
    queryFn: getMe,
    retry: false,
    staleTime: Infinity,
  });

  // Cached data belongs to whoever was signed in: drop all of it whenever the user changes, so the next
  // person on a shared device (a store iPad) never sees the previous user's tasks or buttons. Everything
  // EXCEPT 'auth-me': removing that query would detach the observer above and the app would never notice
  // the next login.
  const dropUserData = useCallback(
    () => queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth-me' }),
    [queryClient]
  );

  // "Server unreachable" is remembered separately from the query state: a retry puts the query back to
  // loading (which would otherwise blank the screen), so keep showing the connection screen until it
  // succeeds or the server answers with a real status (e.g. 401 = logged out).
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    if (session || sessionError?.status) setUnreachable(false);
    else if (sessionError) setUnreachable(true);
  }, [session, sessionError]);

  // Any API call (not just this one) that gets a 401 mid-session should drop back to Login.
  useEffect(() => {
    const onUnauthorized = () => { dropUserData(); queryClient.setQueryData(['auth-me'], null); };
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, [queryClient, dropUserData]);

  const handleLoginSuccess = useCallback(
    (session) => { dropUserData(); queryClient.setQueryData(['auth-me'], session); },
    [queryClient, dropUserData]
  );

  const handleLogout = useCallback(async () => {
    await logoutApi();
    dropUserData();
    queryClient.setQueryData(['auth-me'], null);
  }, [queryClient, dropUserData]);

  const toggleMobileNav = useCallback(() => setMobileNavActive((v) => !v), []);
  const toggleUserMenu = useCallback(() => setUserMenuActive((v) => !v), []);
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
            label: 'Devices',
            icon: WifiIcon,
            url: '/devices',
            onClick: () => navigate('/devices'),
            selected: is('/devices'),
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
          {
            label: 'Draft Orders',
            icon: OrderDraftIcon,
            url: '/draft-orders',
            onClick: () => navigate('/draft-orders'),
            selected: is('/draft-orders'),
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
            label: 'Max Quantity',
            icon: MaximizeIcon,
            url: '/inventory/max-quantity',
            onClick: () => navigate('/inventory/max-quantity'),
            selected: is('/inventory/max-quantity'),
          },
          {
            label: 'Labels',
            icon: PrintIcon,
            url: '/inventory/labels',
            onClick: () => navigate('/inventory/labels'),
            selected: is('/inventory/labels'),
          },
          {
            label: 'Vendor RRP',
            icon: MaximizeIcon,
            url: '/inventory/vendor-rrp',
            onClick: () => navigate('/inventory/vendor-rrp'),
            selected: is('/inventory/vendor-rrp'),
          },
          {
            label: 'Vendor Margins',
            icon: MaximizeIcon,
            url: '/inventory/vendor-margins',
            onClick: () => navigate('/inventory/vendor-margins'),
            selected: is('/inventory/vendor-margins'),
          },
          {
            label: 'Price Scheduler',
            icon: CalendarTimeIcon,
            url: '/price-scheduler',
            onClick: () => navigate('/price-scheduler'),
            selected: is('/price-scheduler'),
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
            label: 'Sales by Vendor',
            icon: ChartLineIcon,
            url: '/consignment/sales-by-vendor',
            onClick: () => navigate('/consignment/sales-by-vendor'),
            selected: is('/consignment/sales-by-vendor'),
          },
          {
            label: 'Consignment',
            icon: ChartLineIcon,
            url: '/consignment',
            onClick: () => navigate('/consignment'),
            selected: location.pathname === '/consignment', // exact: '/consignment/sales-by-vendor' has its own item
          },
          {
            label: 'Foot Traffic',
            icon: PersonIcon,
            url: '/reports/foot-traffic',
            onClick: () => navigate('/reports/foot-traffic'),
            selected: is('/reports/foot-traffic'),
          },
          {
            label: 'Popular Times',
            icon: PersonIcon,
            url: '/reports/popular-times',
            onClick: () => navigate('/reports/popular-times'),
            selected: is('/reports/popular-times'),
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
            label: 'Replenishment',
            icon: RefreshIcon,
            url: '/reports/replenishment',
            onClick: () => navigate('/reports/replenishment'),
            selected: is('/reports/replenishment'),
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
      <Navigation.Section
        items={[
          { label: 'Tasks', icon: CalendarTimeIcon, url: '/tasks', onClick: () => navigate('/tasks'), selected: is('/tasks') },
        ]}
      />
      <Navigation.Section
        title="Admin"
        items={[
          {
            label: 'Users',
            icon: PersonIcon,
            url: '/users',
            onClick: () => navigate('/users'),
            selected: is('/users'),
          },
        ]}
      />
    </Navigation>
  );

  // Non-admin roles get a short nav; the backend allowlist (services/roleAccess.js) is what actually
  // enforces access, this only hides what would 403. Retail gets just Tasks.
  const limitedItems = [
    { label: 'Tasks', icon: CalendarTimeIcon, url: '/tasks' },
    { label: 'Orders', icon: OrderIcon, url: '/orders' },
    { label: 'Products', icon: ProductIcon, url: '/inventory/products' },
    { label: 'Max Quantity', icon: MaximizeIcon, url: '/inventory/max-quantity' },
    { label: 'Labels', icon: PrintIcon, url: '/inventory/labels' },
    { label: 'Adjustments', icon: AdjustIcon, url: '/inventory/adjustments' },
    { label: 'Transfers', icon: TransferIcon, url: '/transfers' },
    { label: 'Reports', icon: ChartLineIcon, url: '/reports' },
  ].map((i) => ({ ...i, onClick: () => navigate(i.url), selected: is(i.url) }));
  const limitedNavigationMarkup = (
    <Navigation location={location.pathname}>
      <Navigation.Section items={session?.role === 'manager' ? limitedItems : limitedItems.slice(0, 1)} />
    </Navigation>
  );

  // No response at all (offline / server down) is not the same as being logged out.
  if (!session && unreachable) return <ConnectionProblem onRetry={refetchSession} retrying={sessionLoading} />;
  if (sessionLoading) return null;
  if (!session) return <Login onLoginSuccess={handleLoginSuccess} />;

  const isAdmin = session.role === 'admin';

  const userMenuMarkup = (
    <TopBar.UserMenu
      actions={[{ items: [{ content: 'Log out', onAction: handleLogout }] }]}
      name={session.user || 'Admin'}
      initials={(session.user || 'A').charAt(0).toUpperCase()}
      open={userMenuActive}
      onToggle={toggleUserMenu}
    />
  );

  const topBarMarkup = (
    <TopBar
      showNavigationToggle
      onNavigationToggle={toggleMobileNav}
      userMenu={userMenuMarkup}
    />
  );

  return (
    <Frame
      logo={topBarLogoSrc ? {
        width: 104,
        topBarSource: topBarLogoSrc,
        url: '/',
        accessibilityLabel: 'Logo',
      } : undefined}
      topBar={topBarMarkup}
      navigation={isAdmin ? navigationMarkup : limitedNavigationMarkup}
      showMobileNavigation={mobileNavActive}
      onNavigationDismiss={toggleMobileNav}
    >
      {!online && (
        <Box padding="400" paddingBlockEnd="0">
          <Banner tone="warning" title="You're offline">
            <p>Changes can't be saved until you're back online. The list shows what was loaded last.</p>
          </Banner>
        </Box>
      )}
      <Routes>
        {isAdmin ? (
          <>
        <Route path="/" element={<Dashboard />} />
        <Route path="/users" element={<Users />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/vendors/:id" element={<VendorDetail />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/suppliers/:id" element={<SupplierDetail />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/devices" element={<Devices />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/purchase-orders/:id" element={<PODetail />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/draft-orders" element={<DraftOrders />} />
        <Route path="/inventory/products" element={<Products />} />
        <Route path="/inventory/max-quantity" element={<MaxQuantity />} />
        <Route path="/consignment" element={<Consignment />} />
        <Route path="/consignment/sales-by-vendor" element={<SalesByVendor />} />
        <Route path="/inventory/labels" element={<Labels />} />
        <Route path="/inventory/vendor-rrp" element={<VendorRrp />} />
        <Route path="/inventory/vendor-margins" element={<VendorMargins />} />
        <Route path="/price-scheduler" element={<PriceScheduler />} />
        <Route path="/inventory/adjustments" element={<Adjustments />} />
        <Route path="/inventory/adjustments/:id" element={<AdjustmentDetail />} />
        <Route path="/transfers/*" element={<Transfers />} />
        <Route path="/reports/*" element={<Reports />} />
          </>
        ) : (
          <>
            {session.role === 'manager' && (
              <>
                <Route path="/orders" element={<Orders />} />
                <Route path="/inventory/products" element={<Products />} />
                <Route path="/inventory/max-quantity" element={<MaxQuantity />} />
                <Route path="/inventory/labels" element={<Labels />} />
                <Route path="/inventory/adjustments" element={<Adjustments />} />
                <Route path="/inventory/adjustments/:id" element={<AdjustmentDetail />} />
                <Route path="/transfers/*" element={<Transfers />} />
                <Route path="/reports/*" element={<Reports />} />
              </>
            )}
            <Route path="*" element={<Tasks />} />
          </>
        )}
      </Routes>
    </Frame>
  );
}
