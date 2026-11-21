-- AlterTable
ALTER TABLE "FundTransaction" ADD COLUMN     "fabricationPaymentId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "FundTransaction_fabricationPaymentId_key" ON "FundTransaction"("fabricationPaymentId");

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_fabricationPaymentId_fkey" FOREIGN KEY ("fabricationPaymentId") REFERENCES "FabricationPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

