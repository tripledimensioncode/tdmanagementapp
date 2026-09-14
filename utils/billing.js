function calculateFabricationTotal(job) {
  const lineItemsTotal = (job.lineItems || []).reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.cost || 0), 0
  );
  const additionalCost = Number(job.cost || 0);

  if (job.type !== '3D_PRINTING') {
    return lineItemsTotal > 0 ? lineItemsTotal : additionalCost;
  }

  const totalMass = (job.files || []).reduce((sum, file) => sum + Number(file.massGrams || 0), 0);
  const printCost = totalMass * Number(job.costPerGram || 0);
  return printCost + additionalCost + lineItemsTotal;
}

function calculatePaymentSummary(job) {
  const invoiceTotal = calculateFabricationTotal(job);
  const paid = (job.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return {
    invoiceTotal,
    paid,
    outstanding: Math.max(0, invoiceTotal - paid),
    overpaid: Math.max(0, paid - invoiceTotal)
  };
}

module.exports = { calculateFabricationTotal, calculatePaymentSummary };
