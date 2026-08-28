'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { NavigationItem } from '@/lib/payload/types';
import { useUrlMap } from '@/components/providers/UrlMapProvider';

interface BreadcrumbProps {
  navigation: NavigationItem[];
}

/**
 * Build breadcrumb trail by finding the path through navigation tree
 */
function buildBreadcrumbTrail(
  items: NavigationItem[],
  targetPath: string,
  trail: Array<{ name: string; path?: string }> = [],
): Array<{ name: string; path?: string }> | null {
  for (const item of items) {
    if (item.path === targetPath) {
      return [...trail, { name: item.name, path: item.path }];
    }

    if (item.children) {
      const found = buildBreadcrumbTrail(item.children, targetPath, [
        ...trail,
        { name: item.name, path: item.path },
      ]);
      if (found) return found;
    }
  }

  return null;
}

export function Breadcrumb({ navigation }: BreadcrumbProps) {
  const pathname = usePathname();
  const { href: urlFor, toPath } = useUrlMap();

  // Home page - don't show breadcrumb
  if (pathname === '/') {
    return null;
  }

  const currentPath = toPath(pathname);

  if (!currentPath) {
    return null;
  }

  const trail = buildBreadcrumbTrail(navigation, currentPath);

  if (!trail || trail.length === 0) {
    return null;
  }

  return (
    <nav className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
      {trail.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <svg
              className="w-3.5 h-3.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}

          {index === trail.length - 1 || !item.path ? (
            <span className="font-medium text-gray-900 dark:text-gray-100">{item.name}</span>
          ) : (
            <Link
              href={urlFor(item.path)}
              className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              {item.name}
            </Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
