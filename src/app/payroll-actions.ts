'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { parseAmount } from '@/lib/money';
import type { ActionResult } from '@/app/actions';

export async function createEmployeeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { business } = await requireContext('EMPLOYEE');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required.' };
  const payType = String(formData.get('payType') ?? 'hourly');
  const rawRate = String(formData.get('rate') ?? '0').trim() || '0';

  let rate: bigint;
  try {
    rate = parseAmount(rawRate, business.functionalCurrency);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid rate.' };
  }

  await prisma.employee.create({
    data: {
      businessId: business.id,
      name,
      email: String(formData.get('email') ?? '').trim() || null,
      title: String(formData.get('title') ?? '').trim() || null,
      payType,
      rate,
    },
  });
  revalidatePath('/payroll/employees');
  return {};
}

export async function archiveEmployeeAction(employeeId: string): Promise<void> {
  const { business } = await requireContext('EMPLOYEE');
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  if (employee.businessId !== business.id) throw new Error('Wrong business.');
  await prisma.employee.update({ where: { id: employeeId }, data: { status: 'ARCHIVED' } });
  revalidatePath('/payroll/employees');
}

export async function logTimesheetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { business } = await requireContext('EMPLOYEE');
  const employeeId = String(formData.get('employeeId') ?? '');
  const weekStart = String(formData.get('weekStart') ?? '');
  const hours = Number(formData.get('hours') ?? '');
  if (!employeeId) return { error: 'Pick an employee.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return { error: 'Pick a week.' };
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) return { error: 'Enter valid hours (1–168).' };

  await prisma.timesheet.create({
    data: {
      businessId: business.id,
      employeeId,
      weekStart: new Date(weekStart),
      hours,
      notes: String(formData.get('notes') ?? '').trim() || null,
    },
  });
  revalidatePath('/payroll/timesheets');
  return {};
}
