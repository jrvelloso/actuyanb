import React from 'react';

import { View } from '@actual-app/components/view';

import { useSidebarMenu } from '#hooks/useSidebarMenu';

import { SecondaryItem } from './SecondaryItem';
import {
  getSidebarMenuItemPath,
  isPrimaryBudgetNavigationItem,
} from './sidebarMenu';
import { useSidebarMenuItemDetails } from './useSidebarMenuItemDetails';

/**
 * Everyday budgeting starts with Budget, Reports, and the account register.
 * The remaining configured destinations remain available below the accounts
 * without removing a user's saved sidebar visibility or ordering preference.
 */
export function SecondaryNavigation() {
  const { sidebarItems } = useSidebarMenu();
  const itemDetails = useSidebarMenuItemDetails();
  const items = sidebarItems.filter(
    item => !isPrimaryBudgetNavigationItem(item.id),
  );

  if (items.length === 0) return null;

  return (
    <View style={{ flexShrink: 0, padding: '5px 0' }}>
      {items.map(item => (
        <SecondaryItem
          key={item.id}
          title={itemDetails[item.id].title}
          Icon={itemDetails[item.id].Icon}
          to={getSidebarMenuItemPath(item.id, true)}
        />
      ))}
    </View>
  );
}
