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
            success: true,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw2REFBeUQ7QUFpQmxELE1BQU0sT0FBTyxHQUErRCxLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUU7SUFDL0YsT0FBTyxDQUFDLEdBQUcsQ0FBQywrQkFBK0IsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDeEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsRUFBRSxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUM7SUFFNUQsZ0NBQWdDO0lBQ2hDLE1BQU0sUUFBUSxHQUFHLElBQUksc0NBQWlCLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBRXhELElBQUk7UUFDQSx3QkFBd0I7UUFDeEIsTUFBTSxRQUFRLENBQUMsUUFBUSxDQUFDLHlCQUF5QixFQUFFLGdCQUFnQixDQUFDLENBQUM7UUFFckUsSUFBSSxlQUFnQyxDQUFDO1FBRXJDLDZDQUE2QztRQUM3QyxJQUFJLEtBQUssQ0FBQyxTQUFTLEVBQUU7WUFDakIsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsS0FBSyxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUM7WUFDM0QsZUFBZSxHQUFHO2dCQUNkLFNBQVMsRUFBRSxLQUFLLENBQUMsU0FBUztnQkFDMUIsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsZUFBZSxFQUFFLHFCQUFxQixLQUFLLENBQUMsU0FBUyxPQUFPO2FBQy9ELENBQUM7U0FDTDthQUFNO1lBQ0gsOEJBQThCO1lBQzlCLGVBQWUsR0FBRyxlQUFlLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1NBQ2hEO1FBRUQsZ0NBQWdDO1FBQ2hDLE1BQU0sUUFBUSxDQUFDLE9BQU8sQ0FBQyxlQUFlLGVBQWUsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsVUFBVSxHQUFHLEdBQUcsQ0FBQyxlQUFlLEVBQUU7WUFDN0gsU0FBUyxFQUFFLGVBQWUsQ0FBQyxTQUFTO1lBQ3BDLFVBQVUsRUFBRSxlQUFlLENBQUMsVUFBVTtZQUN0QyxlQUFlLEVBQUUsZUFBZSxDQUFDLGVBQWU7U0FDbkQsQ0FBQyxDQUFDO1FBRUgsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsZUFBZSxDQUFDLFNBQVMsaUJBQWlCLGVBQWUsQ0FBQyxVQUFVLEdBQUcsQ0FBQyxDQUFDO1FBQzdHLE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLGVBQWUsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxDQUFDO1FBRXBFLE9BQU87WUFDSCxPQUFPLEVBQUUsSUFBSTtZQUNiLFNBQVMsRUFBRSxLQUFLLENBQUMsU0FBUztZQUMxQixTQUFTLEVBQUUsZUFBZSxDQUFDLFNBQVM7WUFDcEMsVUFBVSxFQUFFLGVBQWUsQ0FBQyxVQUFVO1lBQ3RDLE9BQU8sRUFBRSxZQUFZLGVBQWUsQ0FBQyxTQUFTLE9BQU87WUFDckQsZUFBZSxFQUFFLGVBQWUsQ0FBQyxlQUFlO1NBQ25ELENBQUM7S0FFTDtJQUFDLE9BQU8sS0FBSyxFQUFFO1FBQ1osT0FBTyxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUVyRCxNQUFNLFFBQVEsQ0FBQyxLQUFLLENBQUMscURBQXFELENBQUMsQ0FBQztRQUU1RSwwREFBMEQ7UUFDMUQsT0FBTztZQUNILE9BQU8sRUFBRSxJQUFJO1lBQ2IsU0FBUyxFQUFFLEtBQUssQ0FBQyxTQUFTO1lBQzFCLFNBQVMsRUFBRSxLQUFLO1lBQ2hCLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLDhDQUE4QztZQUN2RCxlQUFlLEVBQUUsZ0JBQWdCO1NBQ3BDLENBQUM7S0FDTDtBQUNMLENBQUMsQ0FBQztBQTVEVyxRQUFBLE9BQU8sV0E0RGxCO0FBUUY7Ozs7R0FJRztBQUNILFNBQVMsZUFBZSxDQUFDLEdBQVc7SUFDaEMsSUFBSTtRQUNBLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFFckMsMEVBQTBFO1FBQzFFLElBQUksR0FBRyxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsRUFBRTtZQUMzQyxPQUFPLENBQUMsR0FBRyxDQUFDLDhDQUE4QyxDQUFDLENBQUM7WUFDNUQsT0FBTztnQkFDSCxTQUFTLEVBQUUsU0FBUztnQkFDcEIsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsZUFBZSxFQUFFLDBCQUEwQjthQUM5QyxDQUFDO1NBQ0w7UUFFRCxrRUFBa0U7UUFDbEUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO1FBQ25ELE9BQU87WUFDSCxTQUFTLEVBQUUsS0FBSztZQUNoQixVQUFVLEVBQUUsR0FBRztZQUNmLGVBQWUsRUFBRSxzREFBc0Q7U0FDMUUsQ0FBQztLQUVMO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDWixPQUFPLENBQUMsS0FBSyxDQUFDLG9CQUFvQixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzNDLDJDQUEyQztRQUMzQyxPQUFPO1lBQ0gsU0FBUyxFQUFFLEtBQUs7WUFDaEIsVUFBVSxFQUFFLEdBQUc7WUFDZixlQUFlLEVBQUUsMENBQTBDO1NBQzlELENBQUM7S0FDTDtBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBQcm9ncmVzc1B1Ymxpc2hlciB9IGZyb20gJy4vcHJvZ3Jlc3MtcHVibGlzaGVyJztcblxuaW50ZXJmYWNlIElucHV0VHlwZURldGVjdG9yRXZlbnQge1xuICAgIHVybDogc3RyaW5nO1xuICAgIHNlc3Npb25JZDogc3RyaW5nO1xuICAgIGlucHV0VHlwZT86ICdkb2MnIHwgJ3NpdGVtYXAnIHwgJ2lzc3VlLWRpc2NvdmVyeSc7IC8vIEFsbG93IG1hbnVhbCBvdmVycmlkZSBmcm9tIGZyb250ZW5kXG59XG5cbmludGVyZmFjZSBJbnB1dFR5cGVEZXRlY3RvclJlc3BvbnNlIHtcbiAgICBzdWNjZXNzOiBib29sZWFuO1xuICAgIHNlc3Npb25JZDogc3RyaW5nO1xuICAgIGlucHV0VHlwZTogJ2RvYycgfCAnc2l0ZW1hcCcgfCAnaXNzdWUtZGlzY292ZXJ5JztcbiAgICBjb25maWRlbmNlOiBudW1iZXI7XG4gICAgbWVzc2FnZTogc3RyaW5nO1xuICAgIGRldGVjdGlvblJlYXNvbjogc3RyaW5nO1xufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlcjxJbnB1dFR5cGVEZXRlY3RvckV2ZW50LCBJbnB1dFR5cGVEZXRlY3RvclJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xuICAgIGNvbnNvbGUubG9nKCdEZXRlY3RpbmcgaW5wdXQgdHlwZSBmb3IgVVJMOicsIGV2ZW50LnVybCk7XG4gICAgY29uc29sZS5sb2coJ01hbnVhbCBpbnB1dCB0eXBlIG92ZXJyaWRlOicsIGV2ZW50LmlucHV0VHlwZSk7XG5cbiAgICAvLyBJbml0aWFsaXplIHByb2dyZXNzIHB1Ymxpc2hlclxuICAgIGNvbnN0IHByb2dyZXNzID0gbmV3IFByb2dyZXNzUHVibGlzaGVyKGV2ZW50LnNlc3Npb25JZCk7XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBTZW5kIGluaXRpYWwgcHJvZ3Jlc3NcbiAgICAgICAgYXdhaXQgcHJvZ3Jlc3MucHJvZ3Jlc3MoJ0RldGVjdGluZyBpbnB1dCB0eXBlLi4uJywgJ3VybC1wcm9jZXNzaW5nJyk7XG5cbiAgICAgICAgbGV0IGRldGVjdGlvblJlc3VsdDogRGV0ZWN0aW9uUmVzdWx0O1xuXG4gICAgICAgIC8vIENoZWNrIGlmIGZyb250ZW5kIHByb3ZpZGVkIG1hbnVhbCBvdmVycmlkZVxuICAgICAgICBpZiAoZXZlbnQuaW5wdXRUeXBlKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgVXNpbmcgbWFudWFsIGlucHV0IHR5cGU6ICR7ZXZlbnQuaW5wdXRUeXBlfWApO1xuICAgICAgICAgICAgZGV0ZWN0aW9uUmVzdWx0ID0ge1xuICAgICAgICAgICAgICAgIGlucHV0VHlwZTogZXZlbnQuaW5wdXRUeXBlLFxuICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6IDEuMCxcbiAgICAgICAgICAgICAgICBkZXRlY3Rpb25SZWFzb246IGBNYW51YWwgc2VsZWN0aW9uOiAke2V2ZW50LmlucHV0VHlwZX0gbW9kZWBcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBQZXJmb3JtIGF1dG9tYXRpYyBkZXRlY3Rpb25cbiAgICAgICAgICAgIGRldGVjdGlvblJlc3VsdCA9IGRldGVjdElucHV0VHlwZShldmVudC51cmwpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2VuZCBkZXRlY3Rpb24gcmVzdWx0IG1lc3NhZ2VcbiAgICAgICAgYXdhaXQgcHJvZ3Jlc3Muc3VjY2VzcyhgSW5wdXQgdHlwZTogJHtkZXRlY3Rpb25SZXN1bHQuaW5wdXRUeXBlfSAoJHtNYXRoLnJvdW5kKGRldGVjdGlvblJlc3VsdC5jb25maWRlbmNlICogMTAwKX0lIGNvbmZpZGVuY2UpYCwge1xuICAgICAgICAgICAgaW5wdXRUeXBlOiBkZXRlY3Rpb25SZXN1bHQuaW5wdXRUeXBlLFxuICAgICAgICAgICAgY29uZmlkZW5jZTogZGV0ZWN0aW9uUmVzdWx0LmNvbmZpZGVuY2UsXG4gICAgICAgICAgICBkZXRlY3Rpb25SZWFzb246IGRldGVjdGlvblJlc3VsdC5kZXRlY3Rpb25SZWFzb25cbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYElucHV0IHR5cGUgZGV0ZWN0ZWQ6ICR7ZGV0ZWN0aW9uUmVzdWx0LmlucHV0VHlwZX0gKGNvbmZpZGVuY2U6ICR7ZGV0ZWN0aW9uUmVzdWx0LmNvbmZpZGVuY2V9KWApO1xuICAgICAgICBjb25zb2xlLmxvZyhgRGV0ZWN0aW9uIHJlYXNvbjogJHtkZXRlY3Rpb25SZXN1bHQuZGV0ZWN0aW9uUmVhc29ufWApO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBldmVudC5zZXNzaW9uSWQsXG4gICAgICAgICAgICBpbnB1dFR5cGU6IGRldGVjdGlvblJlc3VsdC5pbnB1dFR5cGUsXG4gICAgICAgICAgICBjb25maWRlbmNlOiBkZXRlY3Rpb25SZXN1bHQuY29uZmlkZW5jZSxcbiAgICAgICAgICAgIG1lc3NhZ2U6IGBEZXRlY3RlZCAke2RldGVjdGlvblJlc3VsdC5pbnB1dFR5cGV9IG1vZGVgLFxuICAgICAgICAgICAgZGV0ZWN0aW9uUmVhc29uOiBkZXRlY3Rpb25SZXN1bHQuZGV0ZWN0aW9uUmVhc29uXG4gICAgICAgIH07XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdJbnB1dCB0eXBlIGRldGVjdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xuXG4gICAgICAgIGF3YWl0IHByb2dyZXNzLmVycm9yKCdJbnB1dCB0eXBlIGRldGVjdGlvbiBmYWlsZWQsIGRlZmF1bHRpbmcgdG8gZG9jIG1vZGUnKTtcblxuICAgICAgICAvLyBEZWZhdWx0IHRvIGRvYyBtb2RlIG9uIGVycm9yIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdWNjZXNzOiB0cnVlLCAvLyBTdGlsbCBzdWNjZXNzZnVsLCBqdXN0IGRlZmF1bHRlZFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBldmVudC5zZXNzaW9uSWQsXG4gICAgICAgICAgICBpbnB1dFR5cGU6ICdkb2MnLFxuICAgICAgICAgICAgY29uZmlkZW5jZTogMC41LFxuICAgICAgICAgICAgbWVzc2FnZTogJ0RlZmF1bHRlZCB0byBkb2MgbW9kZSBkdWUgdG8gZGV0ZWN0aW9uIGVycm9yJyxcbiAgICAgICAgICAgIGRldGVjdGlvblJlYXNvbjogJ0Vycm9yIGZhbGxiYWNrJ1xuICAgICAgICB9O1xuICAgIH1cbn07XG5cbmludGVyZmFjZSBEZXRlY3Rpb25SZXN1bHQge1xuICAgIGlucHV0VHlwZTogJ2RvYycgfCAnc2l0ZW1hcCcgfCAnaXNzdWUtZGlzY292ZXJ5JztcbiAgICBjb25maWRlbmNlOiBudW1iZXI7XG4gICAgZGV0ZWN0aW9uUmVhc29uOiBzdHJpbmc7XG59XG5cbi8qKlxuICogRGV0ZWN0IGlucHV0IHR5cGUgYmFzZWQgb24gVVJMIHBhdHRlcm5zXG4gKiBSZXF1aXJlbWVudHM6IDI4LjEsIDI4LjIsIDI4LjMsIDI4LjhcbiAqIFNpbXBsaWZpZWQgcGVyIHVzZXIgZmVlZGJhY2s6IEp1c3QgY2hlY2sgaWYgVVJMIGNvbnRhaW5zIFwic2l0ZW1hcC54bWxcIlxuICovXG5mdW5jdGlvbiBkZXRlY3RJbnB1dFR5cGUodXJsOiBzdHJpbmcpOiBEZXRlY3Rpb25SZXN1bHQge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBBbmFseXppbmcgVVJMOiAke3VybH1gKTtcblxuICAgICAgICAvLyBTaW1wbGUgY2hlY2s6IGlmIFVSTCBjb250YWlucyBcInNpdGVtYXAueG1sXCIgYW55d2hlcmUsIGl0J3Mgc2l0ZW1hcCBtb2RlXG4gICAgICAgIGlmICh1cmwudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnc2l0ZW1hcC54bWwnKSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ+KchSBTaXRlbWFwIGRldGVjdGVkOiBVUkwgY29udGFpbnMgc2l0ZW1hcC54bWwnKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgaW5wdXRUeXBlOiAnc2l0ZW1hcCcsXG4gICAgICAgICAgICAgICAgY29uZmlkZW5jZTogMS4wLFxuICAgICAgICAgICAgICAgIGRldGVjdGlvblJlYXNvbjogJ1VSTCBjb250YWlucyBzaXRlbWFwLnhtbCdcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBEZWZhdWx0IHRvIGRvYyBtb2RlIGZvciBhbGwgb3RoZXIgVVJMcyAoYmFja3dhcmQgY29tcGF0aWJpbGl0eSlcbiAgICAgICAgY29uc29sZS5sb2coJ+KdjCBEb2MgbW9kZTogTm8gc2l0ZW1hcC54bWwgZGV0ZWN0ZWQnKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlucHV0VHlwZTogJ2RvYycsXG4gICAgICAgICAgICBjb25maWRlbmNlOiAxLjAsXG4gICAgICAgICAgICBkZXRlY3Rpb25SZWFzb246ICdTdGFuZGFyZCBkb2N1bWVudGF0aW9uIFVSTCAobm8gc2l0ZW1hcC54bWwgZGV0ZWN0ZWQpJ1xuICAgICAgICB9O1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgcGFyc2luZyBVUkw6JywgZXJyb3IpO1xuICAgICAgICAvLyBEZWZhdWx0IHRvIGRvYyBtb2RlIG9uIFVSTCBwYXJzaW5nIGVycm9yXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBpbnB1dFR5cGU6ICdkb2MnLFxuICAgICAgICAgICAgY29uZmlkZW5jZTogMS4wLFxuICAgICAgICAgICAgZGV0ZWN0aW9uUmVhc29uOiAnVVJMIHBhcnNpbmcgZXJyb3IsIGRlZmF1bHRlZCB0byBkb2MgbW9kZSdcbiAgICAgICAgfTtcbiAgICB9XG59Il19