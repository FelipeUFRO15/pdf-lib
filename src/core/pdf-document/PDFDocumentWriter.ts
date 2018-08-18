import flatMap from 'lodash/flatMap';
import isNil from 'lodash/isNil';
import last from 'lodash/last';
import sortBy from 'lodash/sortBy';

import PDFDocument from 'core/pdf-document/PDFDocument';
import {
  PDFArray,
  PDFDictionary,
  PDFIndirectObject,
  PDFIndirectReference,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFStream,
} from 'core/pdf-objects';
import {
  PDFCatalog,
  PDFObjectStream,
  PDFTrailer,
  PDFXRefStream,
} from 'core/pdf-structures';
import PDFXRefStreamFactory from 'core/pdf-structures/factories/PDFXRefStreamFactory';
import PDFXRefTableFactory from 'core/pdf-structures/factories/PDFXRefTableFactory';
import { error } from 'utils';

import { PDFTrailerX } from 'core/pdf-structures/PDFTrailer';

class PDFDocumentWriter {
  /**
   * Converts a [[PDFDocument]] object into the raw bytes of a PDF document.
   * These raw bytes could, for example, be saved as a file and opened in a
   * PDF reader.
   *
   * @param pdfDoc The [[PDFDocument]] to be converted to bytes.
   *
   * @returns A `Uint8Array` containing the raw bytes of a PDF document.
   */
  static saveToBytes = (pdfDoc: PDFDocument): Uint8Array => {
    const sortedIndex = PDFDocumentWriter.sortIndex(pdfDoc.index.index);

    const { reference: catalogRef } =
      sortedIndex.find(({ pdfObject }) => pdfObject instanceof PDFCatalog) ||
      error('Missing PDFCatalog');

    const [table, tableOffset] = PDFXRefTableFactory.forIndirectObjects(
      pdfDoc.header,
      sortedIndex,
    );

    const trailer = PDFTrailer.from(
      tableOffset,
      PDFDictionary.from(
        {
          Size: PDFNumber.fromNumber(sortedIndex.length + 1),
          Root: catalogRef,
        },
        pdfDoc.index,
      ),
    );

    const bufferSize = tableOffset + table.bytesSize() + trailer.bytesSize();
    const buffer = new Uint8Array(bufferSize);

    let remaining = pdfDoc.header.copyBytesInto(buffer);
    sortedIndex.forEach((indirectObj) => {
      remaining = indirectObj.copyBytesInto(remaining);
    });
    remaining = table.copyBytesInto(remaining);
    remaining = trailer.copyBytesInto(remaining);

    return buffer;
  };

  /**
   * Converts a [[PDFDocument]] object into the raw bytes of a PDF document.
   * These raw bytes could, for example, be saved as a file and opened in a
   * PDF reader.
   *
   * @param pdfDoc The [[PDFDocument]] to be converted to bytes.
   *
   * @returns A `Uint8Array` containing the raw bytes of a PDF document.
   */
  static saveToBytesWithObjectStreams = (pdfDoc: PDFDocument): Uint8Array => {
    let pdfCatalogRef: PDFIndirectReference<PDFCatalog>;

    const streamObjects: Array<PDFIndirectObject<PDFStream>> = [];
    const nonStreamObjects: Array<PDFIndirectObject<PDFObject>> = [];

    pdfDoc.index.index.forEach((object, ref) => {
      if (object instanceof PDFCatalog) pdfCatalogRef = ref;
      if (object instanceof PDFStream) {
        streamObjects.push(PDFIndirectObject.of(object).setReference(ref));
      } else {
        nonStreamObjects.push(PDFIndirectObject.of(object).setReference(ref));
      }
    });

    if (!pdfCatalogRef!) error('Missing PDFCatalog');

    const { maxObjNum } = pdfDoc;

    const objectStream = PDFObjectStream.create(
      pdfDoc.index,
      nonStreamObjects,
    ).encode();

    const objectStreamRef = PDFIndirectReference.forNumbers(maxObjNum + 1, 0);
    const objectStreamIndObj = PDFIndirectObject.of(objectStream).setReference(
      objectStreamRef,
    );

    streamObjects.push(objectStreamIndObj);

    const [offset, xrefStream] = PDFXRefStreamFactory.forIndirectObjects(
      pdfDoc.header,
      streamObjects,
      objectStreamIndObj,
      pdfDoc.index,
      pdfCatalogRef!,
    );

    // streamObjects.push(xrefStream);

    const trailer = PDFTrailerX.from(offset);

    /* ----- */

    const bufferSize = offset + xrefStream.bytesSize() + trailer.bytesSize();
    const buffer = new Uint8Array(bufferSize);

    let remaining = pdfDoc.header.copyBytesInto(buffer);
    remaining = streamObjects.reduce(
      (remBytes, obj) => obj.copyBytesInto(remBytes),
      remaining,
    );
    remaining = xrefStream.copyBytesInto(remaining);
    remaining = trailer.copyBytesInto(remaining);

    return buffer;
  };

  /** @hidden */
  private static sortIndex = (index: Map<PDFIndirectReference, PDFObject>) => {
    const indexArr: PDFIndirectObject[] = [];
    index.forEach((object, ref) =>
      indexArr.push(PDFIndirectObject.of(object).setReference(ref)),
    );
    indexArr.sort(
      ({ reference: a }, { reference: b }) => a.objectNumber - b.objectNumber,
    );
    return indexArr;
  };
}

export default PDFDocumentWriter;
