import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { PriceBookModule } from './pricebook/pricebook.module';
import { QuotesModule } from './quotes/quotes.module';
import { JobsModule } from './jobs/jobs.module';
import { InvoicesModule } from './invoices/invoices.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    // Config first: everything else depends on a validated environment.
    AppConfigModule,
    PrismaModule,
    // Auth registers the global guard, so it comes before the feature modules
    // whose routes it protects.
    AuthModule,
    CustomersModule,
    PriceBookModule,
    QuotesModule,
    JobsModule,
    InvoicesModule,
    AiModule,
  ],
})
export class AppModule {}
