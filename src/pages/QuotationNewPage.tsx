import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/ui/Toast";
import { QuotationForm } from "../features/quotations/QuotationForm";
import { todayISO } from "../lib/utils";
import { useInvoicing } from "../store/InvoicingContext";

function nextQuotationNumber(existing: string[]): string {
  const numbers = existing
    .map((value) => parseInt(value.replace(/\D/g, ""), 10))
    .filter((value) => !Number.isNaN(value));
  return `QUO-${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

export function QuotationNewPage() {
  const { quotations, addQuotation } = useInvoicing();
  const navigate = useNavigate();
  const toast = useToast();
  const [quotationNumber] = useState(() =>
    nextQuotationNumber(quotations.map((quotation) => quotation.quotationNumber)),
  );

  return (
    <QuotationForm
      mode="new"
      quotationNumber={quotationNumber}
      initialValue={{ date: todayISO() }}
      onSubmit={(value) => {
        const quotation = addQuotation({ quotationNumber, ...value });
        toast.success("تم حفظ عرض قطع الغيار", `رقم ${quotation.quotationNumber}`);
        navigate(`/quotations/${quotation.id}`);
      }}
    />
  );
}
