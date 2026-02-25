from google import genai
import google.genai.types as types

client = genai.Client()
try:
    token = client.auth_tokens.create(
        config={
            'live_connect_constraints': {
                'model': 'models/gemini-2.0-flash-exp',
                'config': {
                    'realtime_input_config': {
                        'automatic_activity_detection': {
                            'silence_duration_ms': 3000,
                            'start_of_speech_sensitivity': types.StartSensitivity.START_SENSITIVITY_LOW,
                            'end_of_speech_sensitivity': types.EndSensitivity.END_SENSITIVITY_LOW,
                        }
                    }
                }
            }
        }
    )
    print('Success!')
except Exception as e:
    print(e)
