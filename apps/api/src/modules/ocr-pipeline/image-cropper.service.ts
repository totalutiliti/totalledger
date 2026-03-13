import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { CropRegion } from './ocr-pipeline.types';

/**
 * Service for cropping specific regions from page PNG images.
 * Used to extract row strips for GPT-5.2 fallback verification,
 * reducing token cost by sending only the problematic area.
 */
@Injectable()
export class ImageCropperService {
  private readonly logger = new Logger(ImageCropperService.name);

  /**
   * Crop multiple regions from a page image.
   * Returns an array of PNG buffers, one per region.
   */
  async cropRegions(
    pageImage: Buffer,
    regions: CropRegion[],
  ): Promise<Buffer[]> {
    if (regions.length === 0) return [];

    const results: Buffer[] = [];

    for (const region of regions) {
      try {
        const cropped = await this.cropSingle(pageImage, region);
        results.push(cropped);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`Failed to crop region "${region.label}": ${message}`, {
          region,
        });
        // Skip failed crops — fallback will use full image if all fail
      }
    }

    return results;
  }

  /**
   * Crop a horizontal row strip from the page image.
   * Used when we know which day rows are problematic but don't have
   * precise cell bounding boxes.
   *
   * @param pageImage - Full page PNG buffer
   * @param rowIndex - 0-based row index in the table
   * @param totalRows - Total number of rows in the table
   * @param tableStartPercent - Where the table starts vertically (% of page height, default 0.15)
   * @param tableEndPercent - Where the table ends vertically (% of page height, default 0.95)
   */
  async cropRowStrip(
    pageImage: Buffer,
    rowIndex: number,
    totalRows: number,
    tableStartPercent = 0.15,
    tableEndPercent = 0.95,
  ): Promise<Buffer> {
    const metadata = await sharp(pageImage).metadata();
    const imgWidth = metadata.width ?? 1700;
    const imgHeight = metadata.height ?? 2400;

    const tableStartY = Math.round(imgHeight * tableStartPercent);
    const tableHeight = Math.round(imgHeight * (tableEndPercent - tableStartPercent));
    const rowHeight = Math.round(tableHeight / totalRows);

    const y = tableStartY + rowIndex * rowHeight;
    // Add padding above and below the row
    const padding = Math.round(rowHeight * 0.2);
    const clampedY = Math.max(0, y - padding);
    const clampedHeight = Math.min(
      rowHeight + padding * 2,
      imgHeight - clampedY,
    );

    return this.cropSingle(pageImage, {
      x: 0,
      y: clampedY,
      width: imgWidth,
      height: clampedHeight,
      label: `row-${rowIndex}`,
    });
  }

  /**
   * Crop multiple row strips for specific days.
   * Maps day numbers to row indices using the table structure.
   *
   * @param pageImage - Full page PNG buffer
   * @param days - Day numbers to crop (1-31)
   * @param totalDataRows - Total data rows in the table (excluding header)
   * @param firstDay - First day number in the table (default 1)
   */
  async cropDayRows(
    pageImage: Buffer,
    days: number[],
    totalDataRows: number,
    firstDay = 1,
  ): Promise<Map<number, Buffer>> {
    const result = new Map<number, Buffer>();

    for (const day of days) {
      const rowIndex = day - firstDay;
      if (rowIndex < 0 || rowIndex >= totalDataRows) continue;

      try {
        // +1 to skip header row in the table
        const cropped = await this.cropRowStrip(
          pageImage,
          rowIndex + 1,
          totalDataRows + 1, // include header row in total
        );
        result.set(day, cropped);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`Failed to crop row for day ${day}: ${message}`);
      }
    }

    this.logger.log('Day rows cropped', {
      requested: days.length,
      cropped: result.size,
    });

    return result;
  }

  /**
   * Crop a single region from an image.
   */
  private async cropSingle(
    pageImage: Buffer,
    region: CropRegion,
  ): Promise<Buffer> {
    const metadata = await sharp(pageImage).metadata();
    const imgWidth = metadata.width ?? 1700;
    const imgHeight = metadata.height ?? 2400;

    // Clamp region to image bounds
    const x = Math.max(0, Math.min(region.x, imgWidth - 1));
    const y = Math.max(0, Math.min(region.y, imgHeight - 1));
    const width = Math.min(region.width, imgWidth - x);
    const height = Math.min(region.height, imgHeight - y);

    if (width <= 0 || height <= 0) {
      throw new Error(
        `Invalid crop region "${region.label}": ${width}x${height} at (${x},${y})`,
      );
    }

    const cropped = await sharp(pageImage)
      .extract({ left: x, top: y, width, height })
      .png()
      .toBuffer();

    this.logger.debug(`Cropped region "${region.label}"`, {
      original: `${imgWidth}x${imgHeight}`,
      crop: `${width}x${height} at (${x},${y})`,
      resultSizeKB: Math.round(cropped.length / 1024),
    });

    return cropped;
  }
}
