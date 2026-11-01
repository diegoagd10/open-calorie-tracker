import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { AccessTokenGuard, RequiresScope } from '../auth/access-token.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { ProductsService, barcodeSchema } from './products.service.js'

@Controller('v1/products')
@UseGuards(AccessTokenGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get(':barcode')
  @RequiresScope('products:read')
  find(@Param('barcode', new ZodValidationPipe(barcodeSchema)) barcode: string) {
    return this.products.find(barcode)
  }
}
