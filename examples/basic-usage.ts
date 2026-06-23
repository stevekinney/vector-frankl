import { VectorDB, VectorOperations } from '../src/index.js';

/**
 * Basic usage example of the Vector Database
 */
async function main() {
  console.log('Vector Database Basic Usage Example\n');

  // Create a database instance for 384-dimensional vectors
  const db = new VectorDB('example-vectors', 384);

  try {
    // Initialize the database
    console.log('Initializing database...');
    await db.init();

    // Create some example vectors (normally these would come from embeddings)
    const documents = [
      {
        id: 'doc1',
        vector: VectorOperations.randomUnit(384),
        metadata: {
          title: 'Introduction to Machine Learning',
          category: 'AI',
          author: 'John Doe',
          year: 2023,
        },
      },
      {
        id: 'doc2',
        vector: VectorOperations.randomUnit(384),
        metadata: {
          title: 'Deep Learning Fundamentals',
          category: 'AI',
          author: 'Jane Smith',
          year: 2024,
        },
      },
      {
        id: 'doc3',
        vector: VectorOperations.randomUnit(384),
        metadata: {
          title: 'Natural Language Processing',
          category: 'AI',
          author: 'Bob Johnson',
          year: 2023,
        },
      },
      {
        id: 'doc4',
        vector: VectorOperations.randomUnit(384),
        metadata: {
          title: 'Web Development Best Practices',
          category: 'Programming',
          author: 'Alice Brown',
          year: 2024,
        },
      },
      {
        id: 'doc5',
        vector: VectorOperations.randomUnit(384),
        metadata: {
          title: 'Database Design Patterns',
          category: 'Programming',
          author: 'Charlie Wilson',
          year: 2022,
        },
      },
    ];

    // Add vectors to the database
    console.log('\nAdding vectors to database...');
    for (const doc of documents) {
      await db.addVector(doc.id, doc.vector, doc.metadata);
      console.log(`Added: ${doc.metadata.title}`);
    }

    // Check database stats
    const stats = await db.getStats();
    console.log(`\nDatabase stats: ${stats.vectorCount} vectors stored`);

    // Retrieve a specific vector
    console.log('\nRetrieving vector by ID...');
    const retrieved = await db.getVector('doc1');
    if (retrieved) {
      console.log(`Retrieved: ${retrieved.metadata?.['title']}`);
      console.log(`Vector dimension: ${retrieved.vector.length}`);
      console.log(`Magnitude: ${retrieved.magnitude.toFixed(4)}`);
    }

    // Check if vectors exist
    console.log('\nChecking vector existence...');
    console.log(`doc1 exists: ${await db.exists('doc1')}`);
    console.log(`doc99 exists: ${await db.exists('doc99')}`);

    // Perform a similarity search
    console.log('\nPerforming similarity search...');

    // Create a query vector (in practice, this would be an embedding of a query)
    const queryVector = VectorOperations.randomUnit(384);

    // Search for the 3 most similar vectors
    const searchResults = await db.search(queryVector, 3, {
      includeMetadata: true,
    });

    console.log('\nTop 3 similar documents:');
    searchResults.forEach((result, index) => {
      console.log(
        `${index + 1}. ${result.metadata?.['title']} (score: ${result.score.toFixed(4)})`,
      );
    });

    // Search with metadata filter
    console.log('\nSearching with metadata filter (category = "AI")...');
    const filteredResults = await db.search(queryVector, 5, {
      filter: { category: 'AI' },
      includeMetadata: true,
    });

    console.log('AI documents found:');
    filteredResults.forEach((result, index) => {
      console.log(
        `${index + 1}. ${result.metadata?.['title']} (score: ${result.score.toFixed(4)})`,
      );
    });

    // Batch operations
    console.log('\nTesting batch operations...');
    const batchVectors = Array.from({ length: 10 }, (_, i) => ({
      id: `batch-${i}`,
      vector: VectorOperations.randomUnit(384),
      metadata: { batch: true, index: i },
    }));

    await db.addBatch(batchVectors, {
      onProgress: (progress) => {
        console.log(
          `Batch progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`,
        );
      },
    });

    // Update stats
    const newStats = await db.getStats();
    console.log(`\nTotal vectors after batch: ${newStats.vectorCount}`);

    // Delete some vectors
    console.log('\nDeleting vectors...');
    await db.deleteVector('doc5');
    const deletedCount = await db.deleteMany(['batch-0', 'batch-1', 'batch-2']);
    console.log(`Deleted ${deletedCount + 1} vectors`);

    // Final stats
    const finalStats = await db.getStats();
    console.log(`\nFinal vector count: ${finalStats.vectorCount}`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Clean up
    console.log('\nCleaning up...');
    await db.close();

    // Optionally delete the database
    // await db.delete();

    console.log('Done!');
  }
}

// Run the example
if (import.meta.main) {
  main().catch(console.error);
}
