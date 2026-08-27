import { ComingSoon } from '@/components/coming-soon';

export default function PayrollPage() {
  return (
    <ComingSoon
      title="Payroll"
      description="W-2 payroll (tax withholding, filings, direct deposit) isn't built yet — it needs a payroll-tax provider and a data-model decision this project hasn't made. 1099 contractor payments are fully supported under Tax filing."
    />
  );
}
