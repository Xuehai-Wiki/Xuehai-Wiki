'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useTabStore } from '@/lib/store/tabStore';
import { NavigationItem } from '@/lib/payload/types';
import { useUrlMap } from '@/components/providers/UrlMapProvider';

interface TabInitializerProps {
  navigation: NavigationItem[];
}

/**
 * Helper function to find navigation item by path
 */
export function findNavigationItemByPath(
  items: NavigationItem[],
  path: string,
): NavigationItem | null {
  const normalizedPath = path.replace(/\/$/, '');

  for (const item of items) {
    if (!item.path) {
      if (item.children) {
        const found = findNavigationItemByPath(item.children, path);
        if (found) return found;
      }
      continue;
    }

    const normalizedItemPath = item.path.replace(/\/$/, '');
    if (normalizedItemPath === normalizedPath) {
      return item;
    }

    if (item.children) {
      const found = findNavigationItemByPath(item.children, path);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Initializes tabs on first load and handles URL changes
 */
export function TabInitializer({ navigation }: TabInitializerProps) {
  const pathname = usePathname();
  const { toPath } = useUrlMap();
  const { tabs, addTab, activeTabId, updateTabPath, navigateInHistory, hasHydrated } =
    useTabStore();
  const isInitialMount = useRef(true);
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (!hasHydrated) return;

    const currentPath = pathname === '/' ? '' : (toPath(pathname) ?? '');

    // Initial mount - set up first tab
    if (isInitialMount.current) {
      if (tabs.length === 0) {
        // No saved tabs - create initial tab based on URL
        const navItem = findNavigationItemByPath(navigation, currentPath);
        const title = navItem?.name || 'New Tab';
        addTab({ title, path: currentPath });
      } else if (activeTabId) {
        // Tabs exist - update active tab to match URL
        const navItem = findNavigationItemByPath(navigation, currentPath);
        const title = navItem?.name || 'New Tab';
        updateTabPath(activeTabId, currentPath, title);
      }

      isInitialMount.current = false;
      previousPathname.current = pathname;
      return;
    }

    // URL changed - add to history
    if (pathname !== previousPathname.current && activeTabId) {
      const navItem = findNavigationItemByPath(navigation, currentPath);
      const title = navItem?.name || 'New Tab';
      navigateInHistory(activeTabId, currentPath, title);
      previousPathname.current = pathname;
    }
  }, [
    hasHydrated,
    tabs.length,
    pathname,
    navigation,
    toPath,
    addTab,
    activeTabId,
    updateTabPath,
    navigateInHistory,
  ]);

  return null;
}
