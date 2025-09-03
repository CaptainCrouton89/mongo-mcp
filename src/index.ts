#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MongoClient, Db, Collection } from "mongodb";

const server = new McpServer({
  name: "mongo-mcp",
  version: "1.0.0",
});

let mongoClient: MongoClient | null = null;
let databases: Map<string, Db> = new Map();

function truncateForOutput(obj: unknown, maxOutputLength: number = 25000): unknown {
  const estimatedSize = JSON.stringify(obj).length;
  if (estimatedSize <= maxOutputLength) {
    return obj;
  }

  function truncateValue(value: unknown): unknown {
    if (typeof value === "string" && value.length > 200) {
      const truncated = value.slice(0, 200);
      const remaining = value.length - 200;
      return `${truncated}...${remaining} more characters`;
    }

    if (Array.isArray(value)) {
      if (value.length <= 1) {
        return value.map((item) => truncateValue(item));
      }
      const firstItem = truncateValue(value[0]);
      const remaining = value.length - 1;
      return [firstItem, `...${remaining} more items`];
    }

    if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      if (keys.length <= 200) {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          result[key] = truncateValue((value as Record<string, unknown>)[key]);
        }
        return result;
      }

      const result: Record<string, unknown> = {};
      const firstKeys = keys.slice(0, 200);
      for (const key of firstKeys) {
        result[key] = truncateValue((value as Record<string, unknown>)[key]);
      }
      const remaining = keys.length - 200;
      result[`...${remaining} more properties`] = "...";
      return result;
    }

    return value;
  }

  return truncateValue(obj);
}

function formatJsonOutput(data: unknown): string {
  const truncatedData = truncateForOutput(data);
  let outputText = JSON.stringify(truncatedData, null, 2);
  
  outputText = outputText.replace(
    /"\.\.\.(\d+) more items"/g,
    "...$1 more items"
  );
  outputText = outputText.replace(
    /"\.\.\.(\d+) more properties": "\.\.\.?"/g,
    "...$1 more properties"
  );
  
  return outputText;
}

function getMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }
  return uri;
}

async function ensureConnection(dbName: string): Promise<Db> {
  if (!mongoClient) {
    const uri = getMongoUri();
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
  }
  
  if (!databases.has(dbName)) {
    databases.set(dbName, mongoClient.db(dbName));
  }
  
  return databases.get(dbName)!;
}

server.tool(
  "mongo-create-document",
  "Create a new document in a MongoDB collection",
  {
    database: z.string().describe("Database name"),
    collection: z.string().describe("Collection name"),
    document: z.record(z.any()).describe("Document to insert as JSON object"),
  },
  async ({ database: dbName, collection: collectionName, document }) => {
    try {
      const db = await ensureConnection(dbName);
      const collection: Collection = db.collection(collectionName);
      
      const result = await collection.insertOne(document);
      
      return {
        content: [
          {
            type: "text",
            text: `Document created successfully with ID: ${result.insertedId}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to create document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);

server.tool(
  "mongo-find-documents",
  "Query documents from a MongoDB collection",
  {
    database: z.string().describe("Database name"),
    collection: z.string().describe("Collection name"),
    filter: z.record(z.any()).optional().describe("Query filter as JSON object (optional)"),
    limit: z.number().optional().describe("Maximum number of documents to return (optional)"),
  },
  async ({ database: dbName, collection: collectionName, filter = {}, limit }) => {
    try {
      const db = await ensureConnection(dbName);
      const collection: Collection = db.collection(collectionName);
      
      let cursor = collection.find(filter);
      if (limit) {
        cursor = cursor.limit(limit);
      }
      
      const documents = await cursor.toArray();
      
      const formattedOutput = formatJsonOutput(documents);
      
      return {
        content: [
          {
            type: "text",
            text: `Found ${documents.length} document(s):\n\n${formattedOutput}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to find documents: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);

server.tool(
  "mongo-update-document",
  "Update documents in a MongoDB collection",
  {
    database: z.string().describe("Database name"),
    collection: z.string().describe("Collection name"),
    filter: z.record(z.any()).describe("Query filter to match documents to update"),
    update: z.record(z.any()).describe("Update operations as JSON object"),
    updateMany: z.boolean().optional().describe("Whether to update multiple documents (default: false)"),
  },
  async ({ database: dbName, collection: collectionName, filter, update, updateMany = false }) => {
    try {
      const db = await ensureConnection(dbName);
      const collection: Collection = db.collection(collectionName);
      
      const result = updateMany 
        ? await collection.updateMany(filter, update)
        : await collection.updateOne(filter, update);
      
      return {
        content: [
          {
            type: "text",
            text: `Update operation completed. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to update document(s): ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);

server.tool(
  "mongo-delete-document",
  "Delete documents from a MongoDB collection",
  {
    database: z.string().describe("Database name"),
    collection: z.string().describe("Collection name"),
    filter: z.record(z.any()).describe("Query filter to match documents to delete"),
    deleteMany: z.boolean().optional().describe("Whether to delete multiple documents (default: false)"),
  },
  async ({ database: dbName, collection: collectionName, filter, deleteMany = false }) => {
    try {
      const db = await ensureConnection(dbName);
      const collection: Collection = db.collection(collectionName);
      
      const result = deleteMany
        ? await collection.deleteMany(filter)
        : await collection.deleteOne(filter);
      
      return {
        content: [
          {
            type: "text",
            text: `Delete operation completed. Deleted ${result.deletedCount} document(s)`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to delete document(s): ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);

server.tool(
  "mongo-aggregate",
  "Execute aggregation pipeline on a MongoDB collection",
  {
    database: z.string().describe("Database name"),
    collection: z.string().describe("Collection name"),
    pipeline: z.array(z.record(z.any())).describe("Aggregation pipeline as array of stage objects"),
  },
  async ({ database: dbName, collection: collectionName, pipeline }) => {
    try {
      const db = await ensureConnection(dbName);
      const collection: Collection = db.collection(collectionName);
      
      const documents = await collection.aggregate(pipeline).toArray();
      
      const formattedOutput = formatJsonOutput(documents);
      
      return {
        content: [
          {
            type: "text",
            text: `Aggregation returned ${documents.length} document(s):\n\n${formattedOutput}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to execute aggregation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);

server.tool(
  "mongo-count-documents",
  "Count documents in a MongoDB collection",
  {
    database: z.string().describe("Database name"),
    collection: z.string().describe("Collection name"),
    filter: z.record(z.any()).optional().describe("Query filter as JSON object (optional)"),
  },
  async ({ database: dbName, collection: collectionName, filter = {} }) => {
    try {
      const db = await ensureConnection(dbName);
      const collection: Collection = db.collection(collectionName);
      
      const count = await collection.countDocuments(filter);
      
      return {
        content: [
          {
            type: "text",
            text: `Found ${count} document(s) matching the filter`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to count documents: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);

server.tool(
  "mongo-list-collections",
  "List all collections in a MongoDB database",
  {
    database: z.string().describe("Database name"),
  },
  async ({ database: dbName }) => {
    try {
      const db = await ensureConnection(dbName);
      
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(col => col.name);
      
      return {
        content: [
          {
            type: "text",
            text: `Collections in database '${dbName}':\n${collectionNames.join('\n')}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list collections: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MongoDB MCP Server running...");
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

main().catch(console.error);
