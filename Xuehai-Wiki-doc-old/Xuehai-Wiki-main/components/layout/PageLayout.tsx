'use client';

import React, { useState } from 'react';
import { NavigationItem } from '@/lib/payload/types';
import { Sidebar } from './Sidebar';
import { MobileMenu } from './MobileMenu';
import { TabBar } from './TabBar';
import { NavigationButtons } from './NavigationButtons';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SearchTrigger } from '@/components/search/SearchTrigger';

/**
 * Props for the PageLayout component
 */
interface PageLayoutProps {
  /** Array of top-level navigation items */
  navigation: NavigationItem[];
  /** Source repository, linked from the sidebar when configured */
  repoUrl?: string;
  /** Page content to render in the main area */
  children: React.ReactNode;
}

/**
 * Main page layout wrapper with responsive navigation
 * Manages the mobile menu open/close state internally.
 *
 * @param props - Component props
 * @param props.navigation - Array of navigation items to display in sidebar/menu
 * @param props.repoUrl - Source repository, linked from the sidebar when set
 * @param props.children - Page content to render in the main content area
 *
 */
export function PageLayout({ navigation, repoUrl, children }: PageLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <header className="md:hidden sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={toggleMobileMenu}
            className="p-2 -ml-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors active:bg-gray-200 dark:active:bg-gray-700 touch-manipulation"
            aria-label="Toggle menu"
            aria-expanded={isMobileMenuOpen}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <SearchTrigger className="mx-3 min-w-0 flex-1" />
          <ThemeToggle />
        </div>
      </header>

      <MobileMenu
        navigation={navigation}
        isOpen={isMobileMenuOpen}
        onClose={closeMobileMenu}
        repoUrl={repoUrl}
      />

      <div className="flex">
        <Sidebar navigation={navigation} repoUrl={repoUrl} />

        <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 flex flex-col">
          <div className="sticky top-0 z-20 bg-white dark:bg-gray-950">
            <TabBar />
            <NavigationButtons navigation={navigation} />
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Wide enough to seat the table-of-contents rail beside the
                article; the article itself stays measured by its own prose
                width. */}
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-12">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
