export class Utils {
  public static sanitizeIfInvalid(descriptionState: string, innerHTMLEditorValue: string, htmlCleanerService: any): string {
    const originalDescription = descriptionState !== innerHTMLEditorValue ? innerHTMLEditorValue : descriptionState;
    return htmlCleanerService.sanitize(originalDescription);

  }
}
