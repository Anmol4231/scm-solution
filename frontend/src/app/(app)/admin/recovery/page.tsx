'use client';

import { useState, useEffect } from 'react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Loader2, AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';

interface Change {
  id: string;
  timestamp: string;
  entityType: string;
  entityId: string;
  recordName: string;
  action: string;
  actionLabel: string;
  changedBy: string;
  changedByEmail?: string;
  facility: string;
  previousValues?: Record<string, unknown>;
  currentValues?: Record<string, unknown>;
  changeDetails?: string;
  canRestore: boolean;
}

interface DeletedMedicine {
  id: string;
  medicineName: string;
  genericName?: string;
  dosageForm?: string;
  category?: string;
  deletedAt: string;
  deletedBy: string;
  deletedByEmail?: string;
}

interface DeletedCategory {
  id: string;
  name: string;
  description?: string;
  deletedAt: string;
  deletedBy: string;
  deletedByEmail?: string;
  linkedMedicines: number;
}

export default function RecoveryPage() {
  const [changes, setChanges] = useState<Change[]>([]);
  const [deletedMedicines, setDeletedMedicines] = useState<DeletedMedicine[]>([]);
  const [deletedCategories, setDeletedCategories] = useState<DeletedCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoreDialog, setRestoreDialog] = useState<{
    open: boolean;
    type?: 'medicine' | 'category';
    id?: string;
    name?: string;
  }>({ open: false });
  const [detailsDialog, setDetailsDialog] = useState<{
    open: boolean;
    change?: Change;
  }>({ open: false });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [changesRes, deletedMedicinesRes, deletedCategoriesRes] = await Promise.all([
        api.get('/admin/recent-changes?limit=100'),
        api.get('/admin/deleted-medicines'),
        api.get('/admin/deleted-categories'),
      ]);

      setChanges(changesRes.data.changes || changesRes.data);
      setDeletedMedicines(deletedMedicinesRes.data);
      setDeletedCategories(deletedCategoriesRes.data);
    } catch (error) {
      console.error('Failed to load recovery data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (type: 'medicine' | 'category', id: string) => {
    try {
      const endpoint =
        type === 'medicine'
          ? `/admin/restore-medicine/${id}`
          : `/admin/restore-category/${id}`;

      await api.post(endpoint);

      // Reload data
      await loadData();
      setRestoreDialog({ open: false });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to restore record';
      alert(`Error: ${message}`);
    }
  };

  const getActionBadgeColor = (action: string) => {
    switch (action) {
      case 'CREATE':
        return 'bg-green-100 text-green-800';
      case 'UPDATE':
        return 'bg-blue-100 text-blue-800';
      case 'SOFT_DELETE':
        return 'bg-red-100 text-red-800';
      case 'RESTORE':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getChangeSummary = (change: Change) => {
    if (!change.previousValues || !change.currentValues) return 'No details available';

    const diffs = [];
    for (const key in change.currentValues) {
      if (change.previousValues[key] !== change.currentValues[key]) {
        diffs.push(
          `${key}: "${change.previousValues[key]}" → "${change.currentValues[key]}"`
        );
      }
    }

    return diffs.length > 0 ? diffs.join(', ') : 'No changes';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Recovery & Audit</h1>
        <p className="text-gray-500">
          View change history and recover deleted records
        </p>
      </div>

      <Tabs defaultValue="changes" className="w-full">
        <TabsList>
          <TabsTrigger value="changes">Recent Changes</TabsTrigger>
          <TabsTrigger value="deleted-medicines">Deleted Medicines</TabsTrigger>
          <TabsTrigger value="deleted-categories">Deleted Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="changes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Change History</CardTitle>
              <CardDescription>
                All create, update, and delete actions on medicines and categories
              </CardDescription>
            </CardHeader>
            <CardContent>
              {changes.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No changes recorded yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date & Time</TableHead>
                        <TableHead>Record</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {changes.map((change) => (
                        <TableRow key={change.id}>
                          <TableCell className="text-sm">
                            {formatDate(new Date(change.timestamp))}
                          </TableCell>
                          <TableCell className="font-medium">
                            {change.recordName}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {change.entityType === 'MedicineCategory'
                                ? 'Category'
                                : 'Medicine'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={getActionBadgeColor(change.action)}>
                              {change.actionLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {change.changedBy}
                            {change.changedByEmail && (
                              <div className="text-xs text-gray-500">
                                {change.changedByEmail}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setDetailsDialog({
                                  open: true,
                                  change,
                                })
                              }
                            >
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deleted-medicines" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                Deleted Medicines
              </CardTitle>
              <CardDescription>
                Soft-deleted medicines can be restored
              </CardDescription>
            </CardHeader>
            <CardContent>
              {deletedMedicines.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No deleted medicines
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Medicine Name</TableHead>
                        <TableHead>Generic Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Deleted At</TableHead>
                        <TableHead>Deleted By</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deletedMedicines.map((medicine) => (
                        <TableRow key={medicine.id}>
                          <TableCell className="font-medium">
                            {medicine.medicineName}
                          </TableCell>
                          <TableCell>{medicine.genericName || '-'}</TableCell>
                          <TableCell>{medicine.category || '-'}</TableCell>
                          <TableCell className="text-sm">
                            {formatDate(new Date(medicine.deletedAt))}
                          </TableCell>
                          <TableCell className="text-sm">
                            {medicine.deletedBy}
                            {medicine.deletedByEmail && (
                              <div className="text-xs text-gray-500">
                                {medicine.deletedByEmail}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setRestoreDialog({
                                  open: true,
                                  type: 'medicine',
                                  id: medicine.id,
                                  name: medicine.medicineName,
                                })
                              }
                            >
                              <RotateCcw className="h-4 w-4 mr-1" />
                              Restore
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deleted-categories" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                Deleted Categories
              </CardTitle>
              <CardDescription>
                Soft-deleted categories can be restored
              </CardDescription>
            </CardHeader>
            <CardContent>
              {deletedCategories.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No deleted categories
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Linked Medicines</TableHead>
                        <TableHead>Deleted At</TableHead>
                        <TableHead>Deleted By</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deletedCategories.map((category) => (
                        <TableRow key={category.id}>
                          <TableCell className="font-medium">
                            {category.name}
                          </TableCell>
                          <TableCell className="text-sm">
                            {category.description || '-'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {category.linkedMedicines}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatDate(new Date(category.deletedAt))}
                          </TableCell>
                          <TableCell className="text-sm">
                            {category.deletedBy}
                            {category.deletedByEmail && (
                              <div className="text-xs text-gray-500">
                                {category.deletedByEmail}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setRestoreDialog({
                                  open: true,
                                  type: 'category',
                                  id: category.id,
                                  name: category.name,
                                })
                              }
                            >
                              <RotateCcw className="h-4 w-4 mr-1" />
                              Restore
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Restore Confirmation Dialog */}
      <AlertDialog
        open={restoreDialog.open}
        onOpenChange={(open) =>
          setRestoreDialog({ ...restoreDialog, open })
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {restoreDialog.type === 'medicine' ? 'Medicine' : 'Category'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to restore "{restoreDialog.name}"? This will
              make it active again in the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (restoreDialog.id && restoreDialog.type) {
                handleRestore(restoreDialog.type, restoreDialog.id);
              }
            }}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Yes, Restore
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>

      {/* Change Details Dialog */}
      <AlertDialog
        open={detailsDialog.open}
        onOpenChange={(open) =>
          setDetailsDialog({ ...detailsDialog, open })
        }
      >
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Change Details</AlertDialogTitle>
          </AlertDialogHeader>
          {detailsDialog.change && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-500">Record</p>
                  <p className="text-sm font-semibold">
                    {detailsDialog.change.recordName}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Action</p>
                  <Badge className={getActionBadgeColor(detailsDialog.change.action)}>
                    {detailsDialog.change.actionLabel}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Changed By</p>
                  <p className="text-sm font-semibold">
                    {detailsDialog.change.changedBy}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Date & Time</p>
                  <p className="text-sm font-semibold">
                    {formatDate(new Date(detailsDialog.change.timestamp))}
                  </p>
                </div>
              </div>

              {detailsDialog.change.previousValues &&
                detailsDialog.change.currentValues && (
                  <div className="border-t pt-4">
                    <p className="text-sm font-semibold mb-2">Changes:</p>
                    <div className="space-y-2 text-sm">
                      {Object.keys(detailsDialog.change.currentValues).map((key) => {
                        const prev = detailsDialog.change!.previousValues![key];
                        const curr = detailsDialog.change!.currentValues![key];
                        if (prev !== curr) {
                          return (
                            <div
                              key={key}
                              className="bg-gray-50 p-2 rounded"
                            >
                              <span className="font-medium capitalize">
                                {key}:
                              </span>{' '}
                              <span className="text-red-600">
                                "{prev}"
                              </span>{' '}
                              →{' '}
                              <span className="text-green-600">
                                "{curr}"
                              </span>
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                )}
            </div>
          )}
          <AlertDialogCancel>Close</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
