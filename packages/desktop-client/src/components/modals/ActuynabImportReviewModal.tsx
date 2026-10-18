import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button, ButtonWithLoading } from '@actual-app/components/button';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type {
  ImportReviewDecision,
  PreparedImportReview,
} from '@actual-app/core/server/transactions/actuynab-review';
import { useQueryClient } from '@tanstack/react-query';

import { Information } from '#components/alerts';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
} from '#components/common/Modal';
import { SectionLabel } from '#components/forms';
import { useCategories } from '#hooks/useCategories';
import { usePayees } from '#hooks/usePayees';
import type { Modal as ModalType } from '#modals/modalsSlice';

type Props = Extract<ModalType, { name: 'actuynab-import-review' }>['options'];

type Draft = Omit<ImportReviewDecision, 'transactionId'>;

function isStructuralReason(reason: string) {
  return [
    'internal-transfer',
    'credit-card-bill-payment',
    'off-budget-financing-transfer',
    'provided-loan-split-preserved',
    'provided-split-preserved',
  ].includes(reason);
}

function confidenceLabel(confidence: string) {
  switch (confidence) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    default:
      return 'Review';
  }
}

function reasonLabel(reason: string) {
  return reason.replaceAll('-', ' ');
}

export function ActuynabImportReviewModal({
  accountId,
  auditCounts,
  batchId,
  sourceTransactions,
  sourceBank = 'other',
  sourceFormat = 'unknown',
  transactionIds,
  updatedTransactionIds,
}: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: { list: categories } = { list: [] } } = useCategories();
  const { data: payees = [] } = usePayees();
  const [review, setReview] = useState<PreparedImportReview | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        let next: PreparedImportReview | null = null;
        if (batchId) {
          next = await send('actuynab-review-load', { batchId });
        } else if (
          (transactionIds && transactionIds.length > 0) ||
          auditCounts
        ) {
          next = await send('actuynab-review-prepare', {
            accountId,
            auditCounts,
            sourceBank,
            sourceFormat,
            sourceTransactions,
            transactionIds: transactionIds ?? [],
            updatedTransactionIds,
          });
        } else {
          const pending = await send('actuynab-review-list-pending', {
            accountId,
          });
          if (pending[0]) {
            next = await send('actuynab-review-load', {
              batchId: pending[0].batchId,
            });
          }
        }
        if (active) setReview(next);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t('Unable to load the import review.'),
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [
    accountId,
    auditCounts,
    batchId,
    sourceBank,
    sourceFormat,
    sourceTransactions,
    t,
    transactionIds,
    updatedTransactionIds,
  ]);

  function setDraft(transactionId: string, draft: Draft) {
    setDrafts(current => ({ ...current, [transactionId]: draft }));
  }

  function bulkApprove() {
    if (!review) return;
    const safe = review.items.filter(
      item =>
        !item.isProtected &&
        !item.possibleDuplicate &&
        !item.classification.requiresManualReview &&
        item.classification.confidence === 'high' &&
        !isStructuralReason(item.classification.reason),
    );
    setDrafts(current => ({
      ...current,
      ...Object.fromEntries(
        safe.map(item => [item.transactionId, { action: 'approve' as const }]),
      ),
    }));
  }

  async function confirm(close: () => void) {
    if (!review) return;
    const decisions = Object.entries(drafts).map(([transactionId, draft]) => ({
      transactionId,
      ...draft,
    }));
    if (decisions.length === 0) {
      setError(t('Select at least one transaction to confirm.'));
      return;
    }
    try {
      setSaving(true);
      const result = await send('actuynab-review-confirm', {
        batchId: review.audit.batchId,
        decisions,
      });
      if (result.errors.length > 0) {
        setError(
          t(
            'Some transactions changed before confirmation. Review them again.',
          ),
        );
        const refreshed = await send('actuynab-review-load', {
          batchId: review.audit.batchId,
        });
        setReview(refreshed);
        return;
      }
      await queryClient.invalidateQueries();
      close();
    } catch (confirmError) {
      setError(
        confirmError instanceof Error
          ? confirmError.message
          : t('Unable to confirm the import review.'),
      );
    } finally {
      setSaving(false);
    }
  }

  const categoryOptions: Array<readonly [string, string]> = categories.map(
    category => [String(category.id), String(category.name)] as const,
  );
  const payeeOptions: Array<readonly [string, string]> = payees.map(payee => [
    payee.id,
    payee.name,
  ]);

  return (
    <Modal name="actuynab-import-review">
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Import review')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View
            style={{ maxWidth: 980, minWidth: 360, marginTop: 15, gap: 12 }}
          >
            {loading && (
              <Text>
                <Trans>Preparing classification review…</Trans>
              </Text>
            )}
            {error && <Information>{error}</Information>}
            {!loading && !review && !error && (
              <Information>
                <Trans>
                  No pending import review was found for this account.
                </Trans>
              </Information>
            )}
            {review && (
              <>
                <Information>
                  <Trans>
                    This review changes only approved payee and category fields.
                    Amounts, dates, reconciled transactions, and splits stay
                    unchanged.
                  </Trans>
                </Information>
                <View
                  style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}
                >
                  <Text>
                    <Trans>Source:</Trans> {review.audit.sourceBank}
                  </Text>
                  <Text>
                    <Trans>Format:</Trans> {review.audit.sourceFormat}
                  </Text>
                  <Text>
                    <Trans>Imported:</Trans> {review.audit.imported}
                  </Text>
                  <Text>
                    <Trans>Potential duplicates:</Trans>{' '}
                    {review.audit.duplicate}
                  </Text>
                </View>
                {review.items.length === 0 && (
                  <Information>
                    <Trans>
                      No imported transactions require classification review.
                    </Trans>
                  </Information>
                )}
                <View style={{ maxHeight: '55vh', overflow: 'auto', gap: 10 }}>
                  {review.items.map(item => {
                    const draft = drafts[item.transactionId];
                    const classification = item.classification;
                    const cannotEdit =
                      item.isProtected ||
                      isStructuralReason(classification.reason);
                    return (
                      <View
                        key={item.transactionId}
                        style={{
                          border: `1px solid ${theme.tableBorder}`,
                          borderRadius: 6,
                          padding: 12,
                          gap: 8,
                          opacity: cannotEdit ? 0.72 : 1,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            gap: 12,
                          }}
                        >
                          <Text style={{ fontWeight: 600 }}>
                            {item.importedPayee || t('(No payee)')}
                          </Text>
                          <Text>{item.date}</Text>
                          <Text>{item.amount}</Text>
                          <Text>
                            <Trans>Confidence:</Trans>{' '}
                            {confidenceLabel(classification.confidence)}
                          </Text>
                        </View>
                        <Text style={{ color: theme.pageTextLight }}>
                          <Trans>Reason:</Trans>{' '}
                          {reasonLabel(classification.reason)}
                          {classification.transferTargetAccountId
                            ? ` · ${t('Transfer candidate')}`
                            : ''}
                          {item.possibleDuplicate
                            ? ` · ${t('Possible duplicate')}`
                            : ''}
                          {item.protectionReason
                            ? ` · ${t(item.protectionReason)}`
                            : ''}
                        </Text>
                        {!cannotEdit && (
                          <View
                            style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              gap: 10,
                              alignItems: 'end',
                            }}
                          >
                            <View style={{ width: 130 }}>
                              <SectionLabel title={t('Decision')} />
                              <Select
                                options={[
                                  ['approve', t('Approve suggestion')],
                                  ['correct', t('Correct')],
                                  ['reject', t('Reject')],
                                ]}
                                value={draft?.action ?? ''}
                                defaultLabel={t('Choose')}
                                onChange={action =>
                                  setDraft(item.transactionId, {
                                    action: action as Draft['action'],
                                    categoryId:
                                      draft?.categoryId ??
                                      classification.proposedCategoryId,
                                    payeeId:
                                      draft?.payeeId ??
                                      classification.proposedPayee?.id ??
                                      null,
                                  })
                                }
                              />
                            </View>
                            {draft?.action === 'correct' && (
                              <>
                                <View style={{ minWidth: 190, flex: 1 }}>
                                  <SectionLabel title={t('Category')} />
                                  <Select
                                    options={categoryOptions}
                                    value={draft.categoryId ?? ''}
                                    defaultLabel={t('No category')}
                                    onChange={categoryId =>
                                      setDraft(item.transactionId, {
                                        ...draft,
                                        categoryId: categoryId || null,
                                      })
                                    }
                                  />
                                </View>
                                <View style={{ minWidth: 190, flex: 1 }}>
                                  <SectionLabel title={t('Payee')} />
                                  <Select
                                    options={payeeOptions}
                                    value={draft.payeeId ?? ''}
                                    defaultLabel={t('Keep imported payee')}
                                    onChange={payeeId =>
                                      setDraft(item.transactionId, {
                                        ...draft,
                                        payeeId: payeeId || null,
                                      })
                                    }
                                  />
                                </View>
                              </>
                            )}
                          </View>
                        )}
                        {cannotEdit && (
                          <Text style={{ color: theme.pageTextLight }}>
                            <Trans>
                              This transaction is protected and cannot be
                              changed by import automation.
                            </Trans>
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
                <ModalButtons>
                  {review.items.length > 0 && (
                    <Button onPress={bulkApprove}>
                      <Trans>Approve safe suggestions</Trans>
                    </Button>
                  )}
                  <Button onPress={() => state.close()}>
                    <Trans>Close</Trans>
                  </Button>
                  {review.items.length > 0 && (
                    <ButtonWithLoading
                      variant="primary"
                      isLoading={saving}
                      onPress={() => confirm(() => state.close())}
                    >
                      <Trans>Confirm decisions</Trans>
                    </ButtonWithLoading>
                  )}
                </ModalButtons>
              </>
            )}
          </View>
        </>
      )}
    </Modal>
  );
}
