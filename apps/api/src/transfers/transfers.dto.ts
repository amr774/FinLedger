import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsString,
  IsUUID,
  Matches,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsISO8601,
} from 'class-validator';
import { Type } from 'class-transformer';
export class FundingDto {
  @ApiProperty({
    example: '10000',
    description: 'Integer minor units as a string. 10000 = EGP 100.00.',
  })
  @IsString()
  @Matches(/^[1-9]\d{0,7}$/)
  amount!: string;
  @ApiProperty({ enum: ['EGP'], default: 'EGP' })
  @IsIn(['EGP'])
  currency!: string;
}
export class TransferDto extends FundingDto {
  @ApiProperty() @IsUUID() sourceId!: string;
  @ApiProperty() @IsUUID() destinationId!: string;
}
export class HistoryQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';
  @ApiPropertyOptional({ enum: ['TRANSFER', 'DEMO_FUNDING'] })
  @IsOptional()
  @IsIn(['TRANSFER', 'DEMO_FUNDING'])
  kind?: 'TRANSFER' | 'DEMO_FUNDING';
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
