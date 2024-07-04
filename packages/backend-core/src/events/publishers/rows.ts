import {
  Event,
  RowsCreatedEvent,
  RowsImportedEvent,
  Table,
} from "@budibase/types"
import { publishEvent } from "../events"

/* eslint-disable */

const created = async (count: number, timestamp?: string | number) => {
  const properties: RowsCreatedEvent = {
    count,
  }
  await publishEvent(Event.ROWS_CREATED, properties, timestamp)
}

const imported = async (table: Table, count: number) => {
  const properties: RowsImportedEvent = {
    tableId: table._id as string,
    count,
  }
  await publishEvent(Event.ROWS_IMPORTED, properties)
}

export default {
  created,
  imported,
}
