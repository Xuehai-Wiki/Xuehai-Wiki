import { describe, it, expect } from 'vitest';
import { extractAllPaths, findActiveItem } from './builder';
import { NavigationItem } from '../payload/types';

describe('extractAllPaths', () => {
  it('should extract paths from flat navigation structure', () => {
    const navigation: NavigationItem[] = [
      { name: 'Home', path: 'home' },
      { name: 'About', path: 'about' },
      { name: 'Contact', path: 'contact' },
    ];

    const paths = extractAllPaths(navigation);
    expect(paths).toEqual(['home', 'about', 'contact']);
  });

  it('should extract paths from nested navigation structure', () => {
    const navigation: NavigationItem[] = [
      { name: 'Home', path: 'home' },
      {
        name: 'Guides',
        children: [
          { name: 'Quick Start', path: 'guides/quick-start' },
          { name: 'Configuration', path: 'guides/configuration' },
        ],
      },
    ];

    const paths = extractAllPaths(navigation);
    expect(paths).toEqual(['home', 'guides/quick-start', 'guides/configuration']);
  });

  it('should handle deeply nested structures', () => {
    const navigation: NavigationItem[] = [
      {
        name: 'Docs',
        children: [
          {
            name: 'API',
            children: [
              { name: 'Authentication', path: 'docs/api/auth' },
              { name: 'Users', path: 'docs/api/users' },
            ],
          },
        ],
      },
    ];

    const paths = extractAllPaths(navigation);
    expect(paths).toEqual(['docs/api/auth', 'docs/api/users']);
  });

  it('should handle items without paths', () => {
    const navigation: NavigationItem[] = [
      { name: 'Section', children: [{ name: 'Page', path: 'page' }] },
    ];

    const paths = extractAllPaths(navigation);
    expect(paths).toEqual(['page']);
  });

  it('should return empty array for empty navigation', () => {
    const paths = extractAllPaths([]);
    expect(paths).toEqual([]);
  });
});

describe('findActiveItem', () => {
  it('should find item in flat navigation structure', () => {
    const navigation: NavigationItem[] = [
      { name: 'Home', path: 'home' },
      { name: 'About', path: 'about' },
    ];

    const item = findActiveItem(navigation, 'about');
    expect(item).toEqual({ name: 'About', path: 'about' });
  });

  it('should find item in nested navigation structure', () => {
    const navigation: NavigationItem[] = [
      { name: 'Home', path: 'home' },
      {
        name: 'Guides',
        children: [
          { name: 'Quick Start', path: 'guides/quick-start' },
          { name: 'Configuration', path: 'guides/configuration' },
        ],
      },
    ];

    const item = findActiveItem(navigation, 'guides/configuration');
    expect(item).toEqual({ name: 'Configuration', path: 'guides/configuration' });
  });

  it('should find item in deeply nested structure', () => {
    const navigation: NavigationItem[] = [
      {
        name: 'Docs',
        children: [
          {
            name: 'API',
            children: [
              { name: 'Authentication', path: 'docs/api/auth' },
              { name: 'Users', path: 'docs/api/users' },
            ],
          },
        ],
      },
    ];

    const item = findActiveItem(navigation, 'docs/api/users');
    expect(item).toEqual({ name: 'Users', path: 'docs/api/users' });
  });

  it('should return null when path is not found', () => {
    const navigation: NavigationItem[] = [
      { name: 'Home', path: 'home' },
      { name: 'About', path: 'about' },
    ];

    const item = findActiveItem(navigation, 'nonexistent');
    expect(item).toBeNull();
  });

  it('should return null for empty navigation', () => {
    const item = findActiveItem([], 'any-path');
    expect(item).toBeNull();
  });
});
