import { VectorFrankl, VectorOperations } from '../src/index.js';

/**
 * Example demonstrating namespace management in Vector Frankl
 */
async function main() {
  console.log('Vector Frankl - Namespace Usage Example\n');

  // Create the main database instance
  const db = new VectorFrankl('my-vector-store');

  try {
    // Initialize the database
    console.log('Initializing Vector Frankl...');
    await db.init();

    // Create different namespaces for different embedding types
    console.log('\n1. Creating namespaces...');
    
    // Products namespace - 384 dimensions (e.g., from sentence-transformers)
    const products = await db.createNamespace('products', {
      dimension: 384,
      distanceMetric: 'cosine',
      description: 'Product embeddings from e-commerce catalog'
    });
    console.log('✓ Created "products" namespace (384D)');

    // Documents namespace - 768 dimensions (e.g., from BERT)
    const documents = await db.createNamespace('documents', {
      dimension: 768,
      distanceMetric: 'euclidean',
      description: 'Document embeddings from knowledge base'
    });
    console.log('✓ Created "documents" namespace (768D)');

    // Images namespace - 512 dimensions (e.g., from CLIP)
    const images = await db.createNamespace('images', {
      dimension: 512,
      distanceMetric: 'cosine',
      description: 'Image embeddings from visual search'
    });
    console.log('✓ Created "images" namespace (512D)');

    // Add vectors to each namespace
    console.log('\n2. Adding vectors to namespaces...');

    // Add product embeddings
    const productData = [
      { id: 'laptop-1', name: 'ThinkPad X1', category: 'Electronics', price: 1299 },
      { id: 'laptop-2', name: 'MacBook Pro', category: 'Electronics', price: 1999 },
      { id: 'phone-1', name: 'iPhone 15', category: 'Electronics', price: 999 },
      { id: 'shoe-1', name: 'Nike Air Max', category: 'Footwear', price: 150 },
      { id: 'shoe-2', name: 'Adidas Ultra Boost', category: 'Footwear', price: 180 }
    ];

    for (const product of productData) {
      await products.addVector(
        product.id,
        VectorOperations.randomUnit(384),
        product
      );
    }
    console.log(`✓ Added ${productData.length} products`);

    // Add document embeddings
    const docData = [
      { id: 'doc-1', title: 'User Manual', type: 'manual', language: 'en' },
      { id: 'doc-2', title: 'API Reference', type: 'technical', language: 'en' },
      { id: 'doc-3', title: 'Tutorial Guide', type: 'tutorial', language: 'en' }
    ];

    for (const doc of docData) {
      await documents.addVector(
        doc.id,
        VectorOperations.randomUnit(768),
        doc
      );
    }
    console.log(`✓ Added ${docData.length} documents`);

    // Add image embeddings
    const imageData = [
      { id: 'img-1', filename: 'product-photo-1.jpg', type: 'product', width: 1024 },
      { id: 'img-2', filename: 'banner-hero.png', type: 'marketing', width: 1920 }
    ];

    for (const img of imageData) {
      await images.addVector(
        img.id,
        VectorOperations.randomUnit(512),
        img
      );
    }
    console.log(`✓ Added ${imageData.length} images`);

    // List all namespaces
    console.log('\n3. Listing all namespaces...');
    const namespaceList = await db.listNamespaces();
    
    for (const ns of namespaceList) {
      console.log(`\nNamespace: ${ns.name}`);
      console.log(`  Dimension: ${ns.config.dimension}`);
      console.log(`  Metric: ${ns.config.distanceMetric}`);
      console.log(`  Vectors: ${ns.stats.vectorCount}`);
      console.log(`  Created: ${new Date(ns.created).toLocaleString()}`);
    }

    // Search within specific namespaces
    console.log('\n4. Searching within namespaces...');

    // Search for products
    console.log('\nSearching in products namespace:');
    const productQuery = VectorOperations.randomUnit(384);
    const productResults = await products.search(productQuery, 3, {
      includeMetadata: true,
      filter: { category: 'Electronics' }
    });

    productResults.forEach((result, i) => {
      console.log(`  ${i + 1}. ${result.metadata?.['name']} (score: ${result.score.toFixed(4)})`);
    });

    // Search for documents
    console.log('\nSearching in documents namespace:');
    const docQuery = VectorOperations.randomUnit(768);
    const docResults = await documents.search(docQuery, 2, {
      includeMetadata: true
    });

    docResults.forEach((result, i) => {
      console.log(`  ${i + 1}. ${result.metadata?.['title']} (score: ${result.score.toFixed(4)})`);
    });

    // Get namespace statistics
    console.log('\n5. Namespace statistics...');
    const productStats = await products.getStats();
    console.log('\nProducts namespace:');
    console.log(`  Vectors: ${productStats.vectorCount}`);
    console.log(`  Dimension: ${productStats.dimension}`);
    console.log(`  Distance metric: ${productStats.distanceMetric}`);

    // Find namespaces by pattern
    console.log('\n6. Finding namespaces by pattern...');
    const techNamespaces = await db.findNamespaces(/^(products|documents)$/);
    console.log(`Found ${techNamespaces.length} namespaces matching pattern`);

    // Namespace switching
    console.log('\n7. Switching between namespaces...');
    
    // Get a namespace by name
    const productsNs = await db.getNamespace('products');
    const vector = await productsNs.getVector('laptop-1');
    if (vector) {
      console.log(`Retrieved from products: ${vector.metadata?.['name']}`);
    }

    // Check storage usage
    console.log('\n8. Storage usage...');
    const totalUsage = await db.getTotalStorageUsage();
    console.log(`Total storage across all namespaces: ~${(totalUsage / 1024).toFixed(2)} KB`);

    // Cache management
    console.log('\n9. Cache management...');
    console.log(`Current cache size: ${db.getCacheSize()} namespaces`);
    
    // Set cache limit (useful for memory management)
    await db.setCacheLimit(2);
    console.log('Cache limit set to 2 namespaces');

    // Clean up a specific namespace
    console.log('\n10. Cleaning up...');
    console.log('Clearing images namespace...');
    await images.clear();
    
    const imagesStats = await images.getStats();
    console.log(`Images namespace now has ${imagesStats.vectorCount} vectors`);

    // Delete a namespace
    console.log('\nDeleting images namespace...');
    await db.deleteNamespace('images');
    
    const remainingNamespaces = await db.listNamespaces();
    console.log(`Remaining namespaces: ${remainingNamespaces.map(ns => ns.name).join(', ')}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Clean up
    console.log('\nFinal cleanup...');
    await db.close();
    console.log('Database closed. Done!');
  }
}

// Demonstrate error handling
async function errorHandlingExample() {
  console.log('\n\nError Handling Example\n');
  
  const db = new VectorFrankl();
  await db.init();

  try {
    // Try to create a namespace with invalid name
    console.log('Attempting to create namespace with invalid name...');
    await db.createNamespace('my namespace!', { dimension: 100 });
  } catch (error) {
    console.log(`✓ Caught error: ${(error as Error).message}`);
  }

  try {
    // Try to create duplicate namespace
    console.log('\nCreating test namespace...');
    await db.createNamespace('test', { dimension: 100 });
    
    console.log('Attempting to create duplicate namespace...');
    await db.createNamespace('test', { dimension: 200 });
  } catch (error) {
    console.log(`✓ Caught error: ${(error as Error).message}`);
  }

  try {
    // Try to get non-existent namespace
    console.log('\nAttempting to get non-existent namespace...');
    await db.getNamespace('does-not-exist');
  } catch (error) {
    console.log(`✓ Caught error: ${(error as Error).message}`);
  }

  await db.deleteAll();
  console.log('\nError handling example completed.');
}

// Run the examples
if (import.meta.main) {
  main()
    .then(() => errorHandlingExample())
    .catch(console.error);
}