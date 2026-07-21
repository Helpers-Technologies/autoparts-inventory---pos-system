import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card, CardBody } from "../components/ui/Card";
import { useToast } from "../components/ui/Toast";
import { QuotationForm } from "../features/quotations/QuotationForm";
import { useInvoicing } from "../store/InvoicingContext";

export function QuotationEditPage() {
  const { id } = useParams();
  const { quotations, updateQuotation } = useInvoicing();
  const navigate = useNavigate();
  const toast = useToast();
  const quotation = quotations.find((item) => item.id === id);

  if (!quotation) {
    return (
      <Card>
        <CardBody className="py-10 text-center">
          <div className="font-medium text-ink">عرض السعر غير موجود</div>
          <Button className="mt-4" onClick={() => navigate("/quotations")}>العودة للقائمة</Button>
        </CardBody>
      </Card>
    );
  }

  if (quotation.status === "converted") {
    return (
      <Card>
        <CardBody className="py-10 text-center">
          <div className="font-medium text-ink">لا يمكن تعديل عرض تم تحويله إلى فاتورة</div>
          <Button className="mt-4" onClick={() => navigate(`/quotations/${quotation.id}`)}>العودة للعرض</Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <QuotationForm
      mode="edit"
      quotationNumber={quotation.quotationNumber}
      initialValue={{
        date: quotation.date,
        validUntil: quotation.validUntil,
        customerId: quotation.customerId,
        customerVehicleId: quotation.customerVehicleId,
        branchId: quotation.branchId,
        priceTierId: quotation.priceTierId,
        discount: quotation.discount,
        notes: quotation.notes,
        lines: quotation.lines,
      }}
      onSubmit={(value) => {
        updateQuotation(quotation.id, value);
        toast.success("تم تحديث عرض قطع الغيار");
        navigate(`/quotations/${quotation.id}`);
      }}
    />
  );
}
