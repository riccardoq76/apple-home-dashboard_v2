import { CustomizationManager } from './CustomizationManager';
import { DashboardConfig } from '../config/DashboardConfig';

export class CardManager {
  private customizationManager: CustomizationManager;

  constructor(customizationManager: CustomizationManager) {
    this.customizationManager = customizationManager;
  }

  // Synchronous version - use when customizations are already loaded
  shouldCardBeTall(entityId: string, areaId: string, context: string = 'home'): boolean {
    let tallCards: string[] = [];

    if (context === 'home') {
      const homeData = this.customizationManager.getCustomization('home');
      tallCards = homeData.tall_cards || [];
    } else {
      const pagesData = this.customizationManager.getCustomization('pages');
      tallCards = pagesData[areaId]?.tall_cards || [];
    }

    const isTall = tallCards.includes(entityId);
    const isNotTall = tallCards.includes(`!${entityId}`);

    if (isTall) {
      return true;
    } else if (isNotTall) {
      return false;
    } else {
      // Default behavior
      const domain = entityId.split('.')[0];
      return DashboardConfig.isDefaultTallDomain(domain);
    }
  }

  // Async version - ensures customizations are loaded first
  async shouldCardBeTallAsync(entityId: string, areaId: string, context: string = 'home'): Promise<boolean> {
    await this.customizationManager.ensureCustomizationsLoaded();
    return this.shouldCardBeTall(entityId, areaId, context);
  }

  async toggleTallCard(entityId: string, areaId: string, context: string = 'home'): Promise<boolean> {
    let tallCards: string[] = [];

    if (context === 'home') {
      const homeData = this.customizationManager.getCustomization('home');
      tallCards = homeData.tall_cards || [];
    } else {
      const pagesData = this.customizationManager.getCustomization('pages');
      if (!pagesData[areaId]) {
        pagesData[areaId] = {};
      }
      tallCards = pagesData[areaId].tall_cards || [];
    }

    const index = tallCards.indexOf(entityId);
    const inverseIndex = tallCards.indexOf(`!${entityId}`);

    let newTallState = false;

    if (index !== -1) {
      // Currently set as tall, remove it
      tallCards.splice(index, 1);
      tallCards.push(`!${entityId}`); // Mark as explicitly not tall
      newTallState = false;
    } else if (inverseIndex !== -1) {
      // Currently set as not tall, make it tall
      tallCards.splice(inverseIndex, 1);
      tallCards.push(entityId);
      newTallState = true;
    } else {
      // Not set, toggle based on default behavior
      const domain = entityId.split('.')[0];
      const defaultTall = DashboardConfig.isDefaultTallDomain(domain);

      if (defaultTall) {
        tallCards.push(`!${entityId}`); // Make it not tall
        newTallState = false;
      } else {
        tallCards.push(entityId); // Make it tall
        newTallState = true;
      }
    }

    // Save back to the correct location
    if (context === 'home') {
      const homeData = this.customizationManager.getCustomization('home');
      homeData.tall_cards = tallCards;
      await this.customizationManager.setCustomization('home', homeData);
    } else {
      const pagesData = this.customizationManager.getCustomization('pages');
      pagesData[areaId].tall_cards = tallCards;
      await this.customizationManager.setCustomization('pages', pagesData);
    }

    return newTallState;
  }

  async saveCardOrder(areaId: string, entityOrder: string[], domain?: string) {
    await this.saveCardOrderWithContext(areaId, entityOrder, 'home', domain);
  }

  async saveCardOrderWithContext(areaId: string, entityOrder: string[], context: string = 'home', domain?: string) {
    // Use the CustomizationManager's methods which now handle the new structure
    await this.customizationManager.saveCardOrderWithContext(areaId, entityOrder, context, domain);
  }

  getSavedCardOrder(areaId: string, domain?: string): string[] {
    return this.getSavedCardOrderWithContext(areaId, 'home', domain);
  }

  getSavedCardOrderWithContext(areaId: string, context: string = 'home', domain?: string): string[] {
    // Use the CustomizationManager's methods which now handle the new structure
    return this.customizationManager.getSavedCardOrderWithContext(areaId, context, domain);
  }

  applySavedCardOrder(cards: any[], savedOrder: string[]): any[] {
    if (!savedOrder || savedOrder.length === 0) {
      return cards;
    }

    // Create a map for quick lookup
    const cardMap = new Map();
    cards.forEach((card) => {
      const entityId = card.entity || card.entityId;
      if (entityId) {
        cardMap.set(entityId, card);
      }
    });

    // Build ordered array based on saved order
    const orderedCards: any[] = [];
    const usedEntityIds = new Set<string>();

    // First, add cards in the saved order
    savedOrder.forEach((entityId) => {
      if (cardMap.has(entityId)) {
        orderedCards.push(cardMap.get(entityId));
        usedEntityIds.add(entityId);
      }
    });

    // Then, add any cards that weren't in the saved order (new entities)
    cards.forEach((card) => {
      const entityId = card.entity || card.entityId;
      if (entityId && !usedEntityIds.has(entityId)) {
        orderedCards.push(card);
      }
    });

    return orderedCards;
  }

  async updateCarouselOrder(areaId: string, sectionType: string, entityOrder: string[]) {
    await this.updateCarouselOrderWithContext(areaId, sectionType, entityOrder, 'home');
  }

  async updateCarouselOrderWithContext(
    areaId: string,
    sectionType: string,
    entityOrder: string[],
    context: string = 'home'
  ) {
    const entities = this.customizationManager.getCustomization('entities');

    if (!entities[areaId]) {
      entities[areaId] = {};
    }

    // Store carousel orders under section-specific keys with context
    const contextSuffix = context === 'home' ? '' : `_${context}`;
    const carouselOrderKey = `${sectionType}Order${contextSuffix}`;
    entities[areaId][carouselOrderKey] = entityOrder;

    await this.customizationManager.setCustomization('entities', entities);
  }

  getSavedCarouselOrder(areaId: string, sectionType: string): string[] {
    return this.getSavedCarouselOrderWithContext(areaId, sectionType, 'home');
  }

  getSavedCarouselOrderWithContext(areaId: string, sectionType: string, context: string = 'home'): string[] {
    const contextSuffix = context === 'home' ? '' : `_${context}`;
    const carouselOrderKey = `${sectionType}Order${contextSuffix}`;
    const entities = this.customizationManager.getCustomization('entities');
    return entities[areaId]?.[carouselOrderKey] || [];
  }
}
