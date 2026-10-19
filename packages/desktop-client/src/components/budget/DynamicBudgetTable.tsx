// @ts-strict-ignore
import React, { useEffect } from 'react';
import type { ComponentProps } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import { AutoSizer } from 'react-virtualized-auto-sizer';

import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';

import { FeatureErrorFallback } from '#components/FeatureErrorFallback';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useGlobalPref } from '#hooks/useGlobalPref';

import { useBudgetMonthCount } from './BudgetMonthCountContext';
import { BudgetPageHeader } from './BudgetPageHeader';
import { BudgetTable } from './BudgetTable';

export const YNAB4_GRID_MONTHS = 3;

export function getNumPossibleMonths(width: number, categoryWidth: number) {
  const estimatedTableWidth = width - categoryWidth;

  if (estimatedTableWidth < 500) {
    return 1;
  } else if (estimatedTableWidth < 750) {
    return 2;
  } else if (estimatedTableWidth < 1000) {
    return 3;
  } else if (estimatedTableWidth < 1250) {
    return 4;
  } else if (estimatedTableWidth < 1500) {
    return 5;
  }

  return 6;
}

export function getBudgetMonthLayout({
  width,
  categoryWidth,
  maxMonths,
  isMultiMonthGrid,
}: {
  width: number;
  categoryWidth: number;
  maxMonths: number;
  isMultiMonthGrid: boolean;
}) {
  const numPossible = getNumPossibleMonths(width, categoryWidth);
  const numMonths = isMultiMonthGrid
    ? YNAB4_GRID_MONTHS
    : Math.min(numPossible, maxMonths);
  const minWidth = categoryWidth + 500 * numMonths;

  return {
    minWidth,
    numMonths,
    numPossible,
    requiresHorizontalScroll: isMultiMonthGrid && width < minWidth,
  };
}

type DynamicBudgetTableProps = {
  width: number;
  height: number;
} & AutoSizingBudgetTableProps;

const DynamicBudgetTable = ({
  type,
  width,
  height,
  prewarmStartMonth,
  startMonth,
  maxMonths = 3,
  isMultiMonthGrid = false,
  monthBounds,
  onMonthSelect,
  onBudgetAction,
  ...props
}: DynamicBudgetTableProps) => {
  const { setDisplayMax } = useBudgetMonthCount();
  const [categoryExpandedStatePref] = useGlobalPref('categoryExpandedState');
  const isGoalTemplatesEnabled = useFeatureFlag('goalTemplatesEnabled');
  const categoryExpandedState = categoryExpandedStatePref ?? 0;

  const categoryWidth = 200 + 100 * categoryExpandedState;
  const { minWidth, numMonths, numPossible } = getBudgetMonthLayout({
    width,
    categoryWidth,
    maxMonths,
    isMultiMonthGrid,
  });

  useEffect(() => {
    setDisplayMax(numPossible);
  }, [setDisplayMax, numPossible]);

  function getValidMonth(month) {
    const start = monthBounds.start;
    const end = monthUtils.subMonths(monthBounds.end, numMonths - 1);

    if (month < start) {
      return start;
    } else if (month > end) {
      return end;
    }
    return month;
  }

  function _onMonthSelect(month) {
    onMonthSelect(getValidMonth(month), numMonths);
  }

  useHotkeys(
    'left',
    () => {
      _onMonthSelect(monthUtils.prevMonth(startMonth));
    },
    {
      preventDefault: true,
      scopes: ['app'],
    },
    [_onMonthSelect, startMonth],
  );
  useHotkeys(
    'right',
    () => {
      _onMonthSelect(monthUtils.nextMonth(startMonth));
    },
    {
      preventDefault: true,
      scopes: ['app'],
    },
    [_onMonthSelect, startMonth],
  );
  useHotkeys(
    '0',
    () => {
      _onMonthSelect(
        monthUtils.subMonths(
          monthUtils.currentMonth(),
          type === 'envelope'
            ? Math.floor((numMonths - 1) / 2)
            : numMonths === 2
              ? 1
              : Math.max(numMonths - 2, 0),
        ),
      );
    },
    {
      preventDefault: true,
      scopes: ['app'],
    },
    [_onMonthSelect, startMonth, numMonths],
  );
  useHotkeys(
    'shift+t',
    () => {
      onBudgetAction(startMonth, 'overwrite-goal-template', null);
    },
    {
      preventDefault: true,
      scopes: ['app'],
      enabled: isGoalTemplatesEnabled,
    },
    [onBudgetAction, startMonth, isGoalTemplatesEnabled],
  );

  return (
    <View
      style={{
        width,
        height,
        alignItems: 'center',
        opacity: width <= 0 || height <= 0 ? 0 : 1,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: minWidth,
          height: isMultiMonthGrid ? '100%' : undefined,
        }}
      >
        <ErrorBoundary FallbackComponent={FeatureErrorFallback}>
          <BudgetPageHeader
            startMonth={prewarmStartMonth}
            numMonths={numMonths}
            monthBounds={monthBounds}
            onMonthSelect={_onMonthSelect}
          />
          <BudgetTable
            type={type}
            prewarmStartMonth={prewarmStartMonth}
            startMonth={startMonth}
            numMonths={numMonths}
            monthBounds={monthBounds}
            onBudgetAction={onBudgetAction}
            isMultiMonthGrid={isMultiMonthGrid}
            gridMinWidth={minWidth}
            {...props}
          />
        </ErrorBoundary>
      </View>
    </View>
  );
};

DynamicBudgetTable.displayName = 'DynamicBudgetTable';

type AutoSizingBudgetTableProps = Omit<
  ComponentProps<typeof BudgetTable>,
  'numMonths'
> & {
  maxMonths: number;
  isMultiMonthGrid?: boolean;
  onMonthSelect: (month: string, numMonths: number) => void;
};

export const AutoSizingBudgetTable = (props: AutoSizingBudgetTableProps) => {
  return (
    <AutoSizer
      renderProp={({ width = 0, height = 0 }) => {
        if (width === 0 || height === 0) {
          return null;
        }

        return <DynamicBudgetTable width={width} height={height} {...props} />;
      }}
    />
  );
};

AutoSizingBudgetTable.displayName = 'AutoSizingBudgetTable';
