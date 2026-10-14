import { Module } from '@nestjs/common';
import { PriceBookController } from './pricebook.controller';
import { PriceBookService } from './pricebook.service';

@Module({ controllers: [PriceBookController], providers: [PriceBookService], exports: [PriceBookService] })
export class PriceBookModule {}
