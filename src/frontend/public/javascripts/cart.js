document.addEventListener('DOMContentLoaded', () => {
  const cartItemsContainer = document.querySelector('.cart-items');
  const totalCountElement = document.querySelector('.total-count');
  const emptyCartButton = document.querySelector('.empty-cart-button');
  const checkoutButton = document.querySelector('.checkout-button');

  // Cache cart state
  let cachedCartItems = [];

  // Fetch and display cart
  async function loadCart() {
    try {
      const response = await fetch('/cart');
      if (!response.ok) {
        throw new Error('Failed to fetch cart');
      }

      const cart = await response.json();
      displayCart(cart);
    } catch (error) {
      console.error('Error loading cart:', error);
      showEmptyCart();
    }
  }

  // Display cart items
  function displayCart(cart) {
    // Cache cart items
    cachedCartItems = cart.items || [];

    if (!cart.items || cart.items.length === 0) {
      showEmptyCart();
      return;
    }

    cartItemsContainer.innerHTML = '';
    
    cart.items.forEach(item => {
      const cartItem = createCartItemElement(item);
      cartItemsContainer.appendChild(cartItem);
    });

    // Update total count
    totalCountElement.textContent = cart.total_items || 0;
    
    // Enable/disable buttons
    emptyCartButton.disabled = false;
    checkoutButton.disabled = false;
  }

  // Create cart item element
  function createCartItemElement(item) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'cart-item';
    
    itemDiv.innerHTML = `
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.item)}</div>
        <div class="cart-item-quantity">Quantity: ${item.quantity}</div>
      </div>
      <div class="cart-item-actions">
        <button class="remove-item-button" data-item="${escapeHtml(item.item)}" data-quantity="${item.quantity}">
          Remove
        </button>
      </div>
    `;

    // Add remove button handler
    const removeButton = itemDiv.querySelector('.remove-item-button');
    removeButton.addEventListener('click', () => removeItem(item.item, item.quantity));

    return itemDiv;
  }

  // Show empty cart message
  function showEmptyCart() {
    cachedCartItems = [];
    cartItemsContainer.innerHTML = '<div class="cart-empty-message">Your cart is empty</div>';
    totalCountElement.textContent = '0';
    emptyCartButton.disabled = true;
    checkoutButton.disabled = true;
  }

  // Remove item from cart
  async function removeItem(itemName, quantity) {
    try {
      const response = await fetch('/cart/remove', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item: itemName,
          quantity: quantity
        })
      });

      if (!response.ok) {
        throw new Error('Failed to remove item');
      }

      const updatedCart = await response.json();
      displayCart(updatedCart);
    } catch (error) {
      console.error('Error removing item:', error);
      alert('Failed to remove item from cart');
    }
  }

  // Empty cart
  async function emptyCart() {
    if (!confirm('Are you sure you want to empty your cart?')) {
      return;
    }

    try {
      const response = await fetch('/cart/empty', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error('Failed to empty cart');
      }

      showEmptyCart();
    } catch (error) {
      console.error('Error emptying cart:', error);
      alert('Failed to empty cart');
    }
  }

  // Handle checkout
  function handleCheckout() {
    alert('Checkout functionality coming soon!');
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Event listeners
  emptyCartButton.addEventListener('click', emptyCart);
  checkoutButton.addEventListener('click', handleCheckout);

  // Load cart on page load
  loadCart();

  // Export functions for external use
  window.refreshCart = loadCart;
  window.getCartItems = function() {
    // Return cached cart items (no fetch needed)
    return cachedCartItems;
  };
});
