export class EditModeManager {
  private _editMode = false;
  private editToggle?: HTMLButtonElement;
  private onEditModeChange: (editMode: boolean) => void;

  constructor(onEditModeChange: (editMode: boolean) => void) {
    this.onEditModeChange = onEditModeChange;
  }

  get editMode(): boolean {
    return this._editMode;
  }

  toggleEditMode() {
    this._editMode = !this._editMode;

    // Notify about the change
    this.onEditModeChange(this._editMode);
  }

  updateEntityWrapperStyles(container: HTMLElement, editMode: boolean) {
    const entityWrappers = container.querySelectorAll('.entity-card-wrapper');

    entityWrappers.forEach((wrapper) => {
      const element = wrapper as HTMLElement;

      if (editMode) {
        element.classList.add('edit-mode');

        // Force refresh of Apple Home cards to update edit mode
        const appleHomeCard = element.querySelector('apple-home-card') as any;
        if (appleHomeCard && typeof appleHomeCard.refreshEditMode === 'function') {
          appleHomeCard.refreshEditMode();
        }
      } else {
        element.classList.remove('edit-mode');

        // Force refresh of Apple Home cards to update edit mode
        const appleHomeCard = element.querySelector('apple-home-card') as any;
        if (appleHomeCard && typeof appleHomeCard.refreshEditMode === 'function') {
          appleHomeCard.refreshEditMode();
        }
      }
    });
  }

  updateHostStyles(shadowRoot: ShadowRoot, content: HTMLElement, editMode: boolean) {
    if (editMode) {
      shadowRoot.host.classList.add('edit-mode');
      content.classList.add('edit-mode');
    } else {
      shadowRoot.host.classList.remove('edit-mode');
      content.classList.remove('edit-mode');
    }
  }
}
