"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const progress_publisher_1 = require("./progress-publisher");
const handler = async (event) => {
    console.log('Detecting input type for URL:', event.url);
    console.log('Manual input type override:', event.inputType);
    // Initialize progress publisher
    const progress = new progress_publisher_1.ProgressPublisher(event.sessionId);
    try {
        // Send initial progress
        await progress.progress('Detecting input type...', 'url-processing');
        let detectionResult;
        // Check if frontend provided manual override
        if (event.inputType) {
            console.log(`Using manual input type: ${event.inputType}`);
            detectionResult = {
                inputType: event.inputType,
                confidence: 1.0,
                detectionReason: `Manual selection: ${event.inputType} mode`
            };
        }
        else {
            // Perform automatic detection
            detectionResult = detectInputType(event.url);
        }
        // Send detection result message
        await progress.success(`Input type: ${detectionResult.inputType} (${Math.round(detectionResult.confidence * 100)}% confidence)`, {
            inputType: detectionResult.inputType,
            confidence: detectionResult.confidence,
            detectionReason: detectionResult.detectionReason
        });
        console.log(`Input type detected: ${detectionResult.inputType} (confidence: ${detectionResult.confidence})`);
        console.log(`Detection reason: ${detectionResult.detectionReason}`);
        return {
            success: true,
            sessionId: event.sessionId,
            inputType: detectionResult.inputType,
            confidence: detectionResult.confidence,
            message: `Detected ${detectionResult.inputType} mode`,
            detectionReason: detectionResult.detectionReason
        };
    }
    catch (error) {
        console.error('Input type detection failed:', error);
        await progress.error('Input type detection failed, defaulting to doc mode');
        // Default to doc mode on error for backward compatibility
        return {
            success: true, // Still successful, just defaulted
            sessionId: event.sessionId,
            inputType: 'doc',
            confidence: 0.5,
            message: 'Defaulted to doc mode due to detection error',
            detectionReason: 'Error fallback'
        };
    }
};
exports.handler = handler;
/**
 * Detect input type based on URL patterns
 * Requirements: 28.1, 28.2, 28.3, 28.8
 * Simplified per user feedback: Just check if URL contains "sitemap.xml"
 */
function detectInputType(url) {
    try {
        console.log(`Analyzing URL: ${url}`);
        // Simple check: if URL contains "sitemap.xml" anywhere, it's sitemap mode
        if (url.toLowerCase().includes('sitemap.xml')) {
            console.log('✅ Sitemap detected: URL contains sitemap.xml');
            return {
                inputType: 'sitemap',
                confidence: 1.0,
                detectionReason: 'URL contains sitemap.xml'
            };
        }
        // Default to doc mode for all other URLs (backward compatibility)
        console.log('❌ Doc mode: No sitemap.xml detected');
        return {
            inputType: 'doc',
            confidence: 1.0,
            detectionReason: 'Standard documentation URL (no sitemap.xml detected)'
        };
    }
    catch (error) {
        console.error('Error parsing URL:', error);
        // Default to doc mode on URL parsing error
        return {
            inputType: 'doc',
            confidence: 1.0,
            detectionReason: 'URL parsing error, defaulted to doc mode'
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw2REFBeUQ7QUFpQmxELE1BQU0sT0FBTyxHQUErRCxLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUU7SUFDL0YsT0FBTyxDQUFDLEdBQUcsQ0FBQywrQkFBK0IsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDeEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsRUFBRSxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUM7SUFFNUQsZ0NBQWdDO0lBQ2hDLE1BQU0sUUFBUSxHQUFHLElBQUksc0NBQWlCLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBRXhELElBQUksQ0FBQztRQUNELHdCQUF3QjtRQUN4QixNQUFNLFFBQVEsQ0FBQyxRQUFRLENBQUMseUJBQXlCLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUVyRSxJQUFJLGVBQWdDLENBQUM7UUFFckMsNkNBQTZDO1FBQzdDLElBQUksS0FBSyxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ2xCLE9BQU8sQ0FBQyxHQUFHLENBQUMsNEJBQTRCLEtBQUssQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1lBQzNELGVBQWUsR0FBRztnQkFDZCxTQUFTLEVBQUUsS0FBSyxDQUFDLFNBQVM7Z0JBQzFCLFVBQVUsRUFBRSxHQUFHO2dCQUNmLGVBQWUsRUFBRSxxQkFBcUIsS0FBSyxDQUFDLFNBQVMsT0FBTzthQUMvRCxDQUFDO1FBQ04sQ0FBQzthQUFNLENBQUM7WUFDSiw4QkFBOEI7WUFDOUIsZUFBZSxHQUFHLGVBQWUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDakQsQ0FBQztRQUVELGdDQUFnQztRQUNoQyxNQUFNLFFBQVEsQ0FBQyxPQUFPLENBQUMsZUFBZSxlQUFlLENBQUMsU0FBUyxLQUFLLElBQUksQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLFVBQVUsR0FBRyxHQUFHLENBQUMsZUFBZSxFQUFFO1lBQzdILFNBQVMsRUFBRSxlQUFlLENBQUMsU0FBUztZQUNwQyxVQUFVLEVBQUUsZUFBZSxDQUFDLFVBQVU7WUFDdEMsZUFBZSxFQUFFLGVBQWUsQ0FBQyxlQUFlO1NBQ25ELENBQUMsQ0FBQztRQUVILE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLGVBQWUsQ0FBQyxTQUFTLGlCQUFpQixlQUFlLENBQUMsVUFBVSxHQUFHLENBQUMsQ0FBQztRQUM3RyxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQixlQUFlLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQztRQUVwRSxPQUFPO1lBQ0gsT0FBTyxFQUFFLElBQUk7WUFDYixTQUFTLEVBQUUsS0FBSyxDQUFDLFNBQVM7WUFDMUIsU0FBUyxFQUFFLGVBQWUsQ0FBQyxTQUFTO1lBQ3BDLFVBQVUsRUFBRSxlQUFlLENBQUMsVUFBVTtZQUN0QyxPQUFPLEVBQUUsWUFBWSxlQUFlLENBQUMsU0FBUyxPQUFPO1lBQ3JELGVBQWUsRUFBRSxlQUFlLENBQUMsZUFBZTtTQUNuRCxDQUFDO0lBRU4sQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLDhCQUE4QixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXJELE1BQU0sUUFBUSxDQUFDLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFDO1FBRTVFLDBEQUEwRDtRQUMxRCxPQUFPO1lBQ0gsT0FBTyxFQUFFLElBQUksRUFBRSxtQ0FBbUM7WUFDbEQsU0FBUyxFQUFFLEtBQUssQ0FBQyxTQUFTO1lBQzFCLFNBQVMsRUFBRSxLQUFLO1lBQ2hCLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLDhDQUE4QztZQUN2RCxlQUFlLEVBQUUsZ0JBQWdCO1NBQ3BDLENBQUM7SUFDTixDQUFDO0FBQ0wsQ0FBQyxDQUFDO0FBNURXLFFBQUEsT0FBTyxXQTREbEI7QUFRRjs7OztHQUlHO0FBQ0gsU0FBUyxlQUFlLENBQUMsR0FBVztJQUNoQyxJQUFJLENBQUM7UUFDRCxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBRXJDLDBFQUEwRTtRQUMxRSxJQUFJLEdBQUcsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUM1QyxPQUFPLENBQUMsR0FBRyxDQUFDLDhDQUE4QyxDQUFDLENBQUM7WUFDNUQsT0FBTztnQkFDSCxTQUFTLEVBQUUsU0FBUztnQkFDcEIsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsZUFBZSxFQUFFLDBCQUEwQjthQUM5QyxDQUFDO1FBQ04sQ0FBQztRQUVELGtFQUFrRTtRQUNsRSxPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxDQUFDLENBQUM7UUFDbkQsT0FBTztZQUNILFNBQVMsRUFBRSxLQUFLO1lBQ2hCLFVBQVUsRUFBRSxHQUFHO1lBQ2YsZUFBZSxFQUFFLHNEQUFzRDtTQUMxRSxDQUFDO0lBRU4sQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLG9CQUFvQixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzNDLDJDQUEyQztRQUMzQyxPQUFPO1lBQ0gsU0FBUyxFQUFFLEtBQUs7WUFDaEIsVUFBVSxFQUFFLEdBQUc7WUFDZixlQUFlLEVBQUUsMENBQTBDO1NBQzlELENBQUM7SUFDTixDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IFByb2dyZXNzUHVibGlzaGVyIH0gZnJvbSAnLi9wcm9ncmVzcy1wdWJsaXNoZXInO1xuXG5pbnRlcmZhY2UgSW5wdXRUeXBlRGV0ZWN0b3JFdmVudCB7XG4gICAgdXJsOiBzdHJpbmc7XG4gICAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgaW5wdXRUeXBlPzogJ2RvYycgfCAnc2l0ZW1hcCcgfCAnaXNzdWUtZGlzY292ZXJ5JzsgLy8gQWxsb3cgbWFudWFsIG92ZXJyaWRlIGZyb20gZnJvbnRlbmRcbn1cblxuaW50ZXJmYWNlIElucHV0VHlwZURldGVjdG9yUmVzcG9uc2Uge1xuICAgIHN1Y2Nlc3M6IGJvb2xlYW47XG4gICAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgaW5wdXRUeXBlOiAnZG9jJyB8ICdzaXRlbWFwJyB8ICdpc3N1ZS1kaXNjb3ZlcnknO1xuICAgIGNvbmZpZGVuY2U6IG51bWJlcjtcbiAgICBtZXNzYWdlOiBzdHJpbmc7XG4gICAgZGV0ZWN0aW9uUmVhc29uOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPElucHV0VHlwZURldGVjdG9yRXZlbnQsIElucHV0VHlwZURldGVjdG9yUmVzcG9uc2U+ID0gYXN5bmMgKGV2ZW50KSA9PiB7XG4gICAgY29uc29sZS5sb2coJ0RldGVjdGluZyBpbnB1dCB0eXBlIGZvciBVUkw6JywgZXZlbnQudXJsKTtcbiAgICBjb25zb2xlLmxvZygnTWFudWFsIGlucHV0IHR5cGUgb3ZlcnJpZGU6JywgZXZlbnQuaW5wdXRUeXBlKTtcblxuICAgIC8vIEluaXRpYWxpemUgcHJvZ3Jlc3MgcHVibGlzaGVyXG4gICAgY29uc3QgcHJvZ3Jlc3MgPSBuZXcgUHJvZ3Jlc3NQdWJsaXNoZXIoZXZlbnQuc2Vzc2lvbklkKTtcblxuICAgIHRyeSB7XG4gICAgICAgIC8vIFNlbmQgaW5pdGlhbCBwcm9ncmVzc1xuICAgICAgICBhd2FpdCBwcm9ncmVzcy5wcm9ncmVzcygnRGV0ZWN0aW5nIGlucHV0IHR5cGUuLi4nLCAndXJsLXByb2Nlc3NpbmcnKTtcblxuICAgICAgICBsZXQgZGV0ZWN0aW9uUmVzdWx0OiBEZXRlY3Rpb25SZXN1bHQ7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgZnJvbnRlbmQgcHJvdmlkZWQgbWFudWFsIG92ZXJyaWRlXG4gICAgICAgIGlmIChldmVudC5pbnB1dFR5cGUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBVc2luZyBtYW51YWwgaW5wdXQgdHlwZTogJHtldmVudC5pbnB1dFR5cGV9YCk7XG4gICAgICAgICAgICBkZXRlY3Rpb25SZXN1bHQgPSB7XG4gICAgICAgICAgICAgICAgaW5wdXRUeXBlOiBldmVudC5pbnB1dFR5cGUsXG4gICAgICAgICAgICAgICAgY29uZmlkZW5jZTogMS4wLFxuICAgICAgICAgICAgICAgIGRldGVjdGlvblJlYXNvbjogYE1hbnVhbCBzZWxlY3Rpb246ICR7ZXZlbnQuaW5wdXRUeXBlfSBtb2RlYFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIFBlcmZvcm0gYXV0b21hdGljIGRldGVjdGlvblxuICAgICAgICAgICAgZGV0ZWN0aW9uUmVzdWx0ID0gZGV0ZWN0SW5wdXRUeXBlKGV2ZW50LnVybCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTZW5kIGRldGVjdGlvbiByZXN1bHQgbWVzc2FnZVxuICAgICAgICBhd2FpdCBwcm9ncmVzcy5zdWNjZXNzKGBJbnB1dCB0eXBlOiAke2RldGVjdGlvblJlc3VsdC5pbnB1dFR5cGV9ICgke01hdGgucm91bmQoZGV0ZWN0aW9uUmVzdWx0LmNvbmZpZGVuY2UgKiAxMDApfSUgY29uZmlkZW5jZSlgLCB7XG4gICAgICAgICAgICBpbnB1dFR5cGU6IGRldGVjdGlvblJlc3VsdC5pbnB1dFR5cGUsXG4gICAgICAgICAgICBjb25maWRlbmNlOiBkZXRlY3Rpb25SZXN1bHQuY29uZmlkZW5jZSxcbiAgICAgICAgICAgIGRldGVjdGlvblJlYXNvbjogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGlvblJlYXNvblxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zb2xlLmxvZyhgSW5wdXQgdHlwZSBkZXRlY3RlZDogJHtkZXRlY3Rpb25SZXN1bHQuaW5wdXRUeXBlfSAoY29uZmlkZW5jZTogJHtkZXRlY3Rpb25SZXN1bHQuY29uZmlkZW5jZX0pYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBEZXRlY3Rpb24gcmVhc29uOiAke2RldGVjdGlvblJlc3VsdC5kZXRlY3Rpb25SZWFzb259YCk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50LnNlc3Npb25JZCxcbiAgICAgICAgICAgIGlucHV0VHlwZTogZGV0ZWN0aW9uUmVzdWx0LmlucHV0VHlwZSxcbiAgICAgICAgICAgIGNvbmZpZGVuY2U6IGRldGVjdGlvblJlc3VsdC5jb25maWRlbmNlLFxuICAgICAgICAgICAgbWVzc2FnZTogYERldGVjdGVkICR7ZGV0ZWN0aW9uUmVzdWx0LmlucHV0VHlwZX0gbW9kZWAsXG4gICAgICAgICAgICBkZXRlY3Rpb25SZWFzb246IGRldGVjdGlvblJlc3VsdC5kZXRlY3Rpb25SZWFzb25cbiAgICAgICAgfTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0lucHV0IHR5cGUgZGV0ZWN0aW9uIGZhaWxlZDonLCBlcnJvcik7XG5cbiAgICAgICAgYXdhaXQgcHJvZ3Jlc3MuZXJyb3IoJ0lucHV0IHR5cGUgZGV0ZWN0aW9uIGZhaWxlZCwgZGVmYXVsdGluZyB0byBkb2MgbW9kZScpO1xuXG4gICAgICAgIC8vIERlZmF1bHQgdG8gZG9jIG1vZGUgb24gZXJyb3IgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsIC8vIFN0aWxsIHN1Y2Nlc3NmdWwsIGp1c3QgZGVmYXVsdGVkXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50LnNlc3Npb25JZCxcbiAgICAgICAgICAgIGlucHV0VHlwZTogJ2RvYycsXG4gICAgICAgICAgICBjb25maWRlbmNlOiAwLjUsXG4gICAgICAgICAgICBtZXNzYWdlOiAnRGVmYXVsdGVkIHRvIGRvYyBtb2RlIGR1ZSB0byBkZXRlY3Rpb24gZXJyb3InLFxuICAgICAgICAgICAgZGV0ZWN0aW9uUmVhc29uOiAnRXJyb3IgZmFsbGJhY2snXG4gICAgICAgIH07XG4gICAgfVxufTtcblxuaW50ZXJmYWNlIERldGVjdGlvblJlc3VsdCB7XG4gICAgaW5wdXRUeXBlOiAnZG9jJyB8ICdzaXRlbWFwJyB8ICdpc3N1ZS1kaXNjb3ZlcnknO1xuICAgIGNvbmZpZGVuY2U6IG51bWJlcjtcbiAgICBkZXRlY3Rpb25SZWFzb246IHN0cmluZztcbn1cblxuLyoqXG4gKiBEZXRlY3QgaW5wdXQgdHlwZSBiYXNlZCBvbiBVUkwgcGF0dGVybnNcbiAqIFJlcXVpcmVtZW50czogMjguMSwgMjguMiwgMjguMywgMjguOFxuICogU2ltcGxpZmllZCBwZXIgdXNlciBmZWVkYmFjazogSnVzdCBjaGVjayBpZiBVUkwgY29udGFpbnMgXCJzaXRlbWFwLnhtbFwiXG4gKi9cbmZ1bmN0aW9uIGRldGVjdElucHV0VHlwZSh1cmw6IHN0cmluZyk6IERldGVjdGlvblJlc3VsdCB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coYEFuYWx5emluZyBVUkw6ICR7dXJsfWApO1xuXG4gICAgICAgIC8vIFNpbXBsZSBjaGVjazogaWYgVVJMIGNvbnRhaW5zIFwic2l0ZW1hcC54bWxcIiBhbnl3aGVyZSwgaXQncyBzaXRlbWFwIG1vZGVcbiAgICAgICAgaWYgKHVybC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdzaXRlbWFwLnhtbCcpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygn4pyFIFNpdGVtYXAgZGV0ZWN0ZWQ6IFVSTCBjb250YWlucyBzaXRlbWFwLnhtbCcpO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBpbnB1dFR5cGU6ICdzaXRlbWFwJyxcbiAgICAgICAgICAgICAgICBjb25maWRlbmNlOiAxLjAsXG4gICAgICAgICAgICAgICAgZGV0ZWN0aW9uUmVhc29uOiAnVVJMIGNvbnRhaW5zIHNpdGVtYXAueG1sJ1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERlZmF1bHQgdG8gZG9jIG1vZGUgZm9yIGFsbCBvdGhlciBVUkxzIChiYWNrd2FyZCBjb21wYXRpYmlsaXR5KVxuICAgICAgICBjb25zb2xlLmxvZygn4p2MIERvYyBtb2RlOiBObyBzaXRlbWFwLnhtbCBkZXRlY3RlZCcpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgaW5wdXRUeXBlOiAnZG9jJyxcbiAgICAgICAgICAgIGNvbmZpZGVuY2U6IDEuMCxcbiAgICAgICAgICAgIGRldGVjdGlvblJlYXNvbjogJ1N0YW5kYXJkIGRvY3VtZW50YXRpb24gVVJMIChubyBzaXRlbWFwLnhtbCBkZXRlY3RlZCknXG4gICAgICAgIH07XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBwYXJzaW5nIFVSTDonLCBlcnJvcik7XG4gICAgICAgIC8vIERlZmF1bHQgdG8gZG9jIG1vZGUgb24gVVJMIHBhcnNpbmcgZXJyb3JcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlucHV0VHlwZTogJ2RvYycsXG4gICAgICAgICAgICBjb25maWRlbmNlOiAxLjAsXG4gICAgICAgICAgICBkZXRlY3Rpb25SZWFzb246ICdVUkwgcGFyc2luZyBlcnJvciwgZGVmYXVsdGVkIHRvIGRvYyBtb2RlJ1xuICAgICAgICB9O1xuICAgIH1cbn0iXX0=